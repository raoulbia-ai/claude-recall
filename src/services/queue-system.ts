import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';
import { LoggingService } from './logging';

export interface QueueMessage {
  id?: number;
  queue_name: string;
  payload: any;
  priority: number;
  scheduled_at: number;
  created_at: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'retrying';
  retry_count: number;
  max_retries: number;
  error_message?: string;
  processed_at?: number;
  next_retry_at?: number;
  correlation_id?: string;
  message_type: string;
  metadata?: any;
}

export interface QueueStats {
  queueName: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  retrying: number;
  totalProcessed: number;
  avgProcessingTime: number;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  useJitter: boolean;
  backoffMultiplier: number;
}

export interface QueueProcessorConfig {
  batchSize: number;
  processingTimeout: number;
  cleanupInterval: number;
  retentionPeriod: number;
}

export interface QueueConfiguration {
  retryConfig: RetryConfig;
  processorConfig: QueueProcessorConfig;
}

export class QueueSystem {
  private static instance: QueueSystem;
  private db: Database.Database;
  private config = ConfigService.getInstance();
  private logger = LoggingService.getInstance();
  private processors = new Map<string, QueueProcessor>();
  private cleanupInterval?: NodeJS.Timeout;
  private isShuttingDown = false;
  private preparedStatements = new Map<string, Database.Statement>();
  private supportsReturning = false;

  private constructor() {
    try {
      const dbPath = this.config.getDatabasePath();
      this.db = new Database(dbPath);
      this.configureDatabase();
      this.checkSQLiteVersion();
      this.initializeSchema();
      this.startCleanupProcess();
      
      this.logger.info('QueueSystem', `Initialized with database: ${dbPath}`);
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to initialize', error);
      throw new Error(`Failed to initialize QueueSystem: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private configureDatabase(): void {
    try {
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('cache_size = 10000');
      this.db.pragma('temp_store = MEMORY');
      this.db.pragma('wal_autocheckpoint = 1000');
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to configure database', error);
      throw error;
    }
  }

  /**
   * Check SQLite version for RETURNING clause support
   */
  private checkSQLiteVersion(): void {
    try {
      const result = this.db.prepare('SELECT sqlite_version() as version').get() as { version: string };
      const version = result.version;
      const [major, minor, patch] = version.split('.').map(Number);
      
      // RETURNING clause requires SQLite 3.35.0+
      this.supportsReturning = major > 3 || (major === 3 && minor >= 35);
      
      this.logger.info('QueueSystem', `SQLite version: ${version}, RETURNING support: ${this.supportsReturning}`);
      
      if (!this.supportsReturning) {
        this.logger.warn('QueueSystem', 'SQLite version does not support RETURNING clause. Using fallback method.');
      }
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to check SQLite version', error);
      this.supportsReturning = false;
    }
  }

  /**
   * Get or create a prepared statement with caching
   * Includes automatic cleanup of unused statements to prevent memory leaks
   */
  private getPreparedStatement(key: string, sql: string): Database.Statement {
    // Limit cache size to prevent unbounded growth
    const MAX_CACHE_SIZE = 100;
    
    if (!this.preparedStatements.has(key)) {
      // Clear old entries if cache is too large
      if (this.preparedStatements.size >= MAX_CACHE_SIZE) {
        const entriesToRemove = Math.floor(MAX_CACHE_SIZE * 0.2); // Remove 20% of oldest entries
        const keysToRemove = Array.from(this.preparedStatements.keys()).slice(0, entriesToRemove);
        keysToRemove.forEach(k => {
          // Remove from cache - better-sqlite3 handles cleanup automatically
          this.preparedStatements.delete(k);
        });
        this.logger.debug('QueueSystem', 'Cleared prepared statement cache', { removed: entriesToRemove });
      }
      
      this.preparedStatements.set(key, this.db.prepare(sql));
    }
    return this.preparedStatements.get(key)!;
  }

  static getInstance(): QueueSystem {
    if (!QueueSystem.instance) {
      QueueSystem.instance = new QueueSystem();
    }
    return QueueSystem.instance;
  }

  /**
   * Reset the singleton instance (for testing only)
   * @internal
   */
  static resetInstance(): void {
    if (QueueSystem.instance) {
      QueueSystem.instance.close();
      QueueSystem.instance = null as any;
    }
  }

  /**
   * Initialize the queue database schema
   */
  private initializeSchema(): void {
    const transaction = this.db.transaction(() => {
      // Main queue messages table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS queue_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          queue_name TEXT NOT NULL,
          payload TEXT NOT NULL,
          priority INTEGER DEFAULT 0,
          scheduled_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          retry_count INTEGER DEFAULT 0,
          max_retries INTEGER DEFAULT 3,
          error_message TEXT,
          processed_at INTEGER,
          next_retry_at INTEGER,
          correlation_id TEXT,
          message_type TEXT NOT NULL,
          metadata TEXT,
          
          CONSTRAINT chk_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying'))
        );
      `);

      // Queue configuration table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS queue_configs (
          queue_name TEXT PRIMARY KEY,
          max_retries INTEGER DEFAULT 3,
          base_delay_ms INTEGER DEFAULT 1000,
          max_delay_ms INTEGER DEFAULT 300000,
          use_jitter INTEGER DEFAULT 1,
          backoff_multiplier REAL DEFAULT 2.0,
          batch_size INTEGER DEFAULT 10,
          processing_timeout INTEGER DEFAULT 30000,
          retention_period INTEGER DEFAULT 604800000,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      // Dead letter queue for failed messages
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS dead_letter_queue (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_queue_name TEXT NOT NULL,
          original_message_id INTEGER NOT NULL,
          payload TEXT NOT NULL,
          error_message TEXT NOT NULL,
          retry_count INTEGER NOT NULL,
          failed_at INTEGER NOT NULL,
          correlation_id TEXT,
          message_type TEXT NOT NULL,
          metadata TEXT
        );
      `);

      // Performance indexes
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_queue_messages_queue_status 
        ON queue_messages(queue_name, status);
        
        CREATE INDEX IF NOT EXISTS idx_queue_messages_scheduled 
        ON queue_messages(scheduled_at) WHERE status IN ('pending', 'retrying');
        
        CREATE INDEX IF NOT EXISTS idx_queue_messages_priority 
        ON queue_messages(queue_name, priority DESC, created_at ASC) 
        WHERE status IN ('pending', 'retrying');
        
        CREATE INDEX IF NOT EXISTS idx_queue_messages_correlation 
        ON queue_messages(correlation_id) WHERE correlation_id IS NOT NULL;
        
        CREATE INDEX IF NOT EXISTS idx_queue_messages_message_type
        ON queue_messages(queue_name, message_type);
        
        CREATE INDEX IF NOT EXISTS idx_queue_messages_cleanup 
        ON queue_messages(status, processed_at) WHERE status IN ('completed', 'failed');
        
        CREATE INDEX IF NOT EXISTS idx_queue_messages_next_retry 
        ON queue_messages(next_retry_at) 
        WHERE status = 'retrying' AND next_retry_at IS NOT NULL;
        
        CREATE INDEX IF NOT EXISTS idx_dead_letter_failed_at 
        ON dead_letter_queue(failed_at);
        
        CREATE INDEX IF NOT EXISTS idx_dead_letter_composite
        ON dead_letter_queue(original_queue_name, failed_at DESC);
      `);

      this.logger.info('QueueSystem', 'Database schema initialized successfully');
    });

    try {
      transaction();
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to initialize schema', error);
      throw error;
    }
  }

  /**
   * Enqueue a message with validation
   */
  enqueue(
    queueName: string,
    messageType: string,
    payload: any,
    options: {
      priority?: number;
      scheduledAt?: number;
      maxRetries?: number;
      correlationId?: string;
      metadata?: any;
    } = {}
  ): number {
    // Validate inputs
    if (!queueName || !messageType) {
      throw new Error('Queue name and message type are required');
    }

    // Check queue size limit
    const maxQueueSize = 10000; // Maximum messages per queue
    const currentSize = this.getQueueSize(queueName);
    
    if (currentSize >= maxQueueSize) {
      this.logger.error('QueueSystem', 'Queue size limit exceeded', {
        queueName,
        currentSize,
        maxQueueSize
      });
      
      // Try to cleanup old completed messages
      this.cleanupOldMessages();
      
      // Check again after cleanup
      const sizeAfterCleanup = this.getQueueSize(queueName);
      if (sizeAfterCleanup >= maxQueueSize) {
        throw new Error(`Queue ${queueName} has reached maximum size of ${maxQueueSize} messages`);
      }
    }

    // Validate payload size (limit to 1MB)
    const payloadStr = JSON.stringify(payload);
    if (payloadStr.length > 1048576) {
      throw new Error('Payload exceeds maximum size of 1MB');
    }

    const now = Date.now();
    const message: Partial<QueueMessage> = {
      queue_name: queueName,
      message_type: messageType,
      payload: payloadStr,
      priority: Math.max(0, Math.min(100, options.priority || 0)), // Clamp priority 0-100
      scheduled_at: options.scheduledAt || now,
      created_at: now,
      status: 'pending',
      retry_count: 0,
      max_retries: Math.max(0, Math.min(10, options.maxRetries || 3)), // Clamp retries 0-10
      correlation_id: options.correlationId,
      metadata: options.metadata ? JSON.stringify(options.metadata) : null
    };

    try {
      const stmt = this.getPreparedStatement('enqueue', `
        INSERT INTO queue_messages (
          queue_name, message_type, payload, priority, scheduled_at, 
          created_at, status, retry_count, max_retries, correlation_id, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        message.queue_name,
        message.message_type,
        message.payload,
        message.priority,
        message.scheduled_at,
        message.created_at,
        message.status,
        message.retry_count,
        message.max_retries,
        message.correlation_id,
        message.metadata
      );

      const messageId = result.lastInsertRowid as number;
      
      this.logger.info('QueueSystem', 'Message enqueued', {
        messageId,
        queueName,
        messageType,
        priority: message.priority,
        scheduledAt: message.scheduled_at
      });

      return messageId;
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to enqueue message', error);
      throw new Error(`Failed to enqueue message: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Batch enqueue multiple messages efficiently
   */
  enqueueBatch(messages: Array<{
    queueName: string;
    messageType: string;
    payload: any;
    options?: {
      priority?: number;
      scheduledAt?: number;
      maxRetries?: number;
      correlationId?: string;
      metadata?: any;
    };
  }>): number[] {
    if (messages.length === 0) {
      return [];
    }

    // Use transaction for batch insert with prepared statement
    const transaction = this.db.transaction(() => {
      const messageIds: number[] = [];
      const now = Date.now();
      
      // Prepare statement once for all inserts
      const stmt = this.db.prepare(`
        INSERT INTO queue_messages (
          queue_name, message_type, payload, priority, scheduled_at, 
          created_at, status, retry_count, max_retries, correlation_id, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const msg of messages) {
        try {
          // Validate inputs
          if (!msg.queueName || !msg.messageType) {
            throw new Error('Queue name and message type are required');
          }

          // Validate payload size (limit to 1MB)
          const payloadStr = JSON.stringify(msg.payload);
          if (payloadStr.length > 1048576) {
            throw new Error('Payload exceeds maximum size of 1MB');
          }

          const result = stmt.run(
            msg.queueName,
            msg.messageType,
            payloadStr,
            Math.max(0, Math.min(100, msg.options?.priority || 0)),
            msg.options?.scheduledAt || now,
            now,
            'pending',
            0,
            Math.max(0, Math.min(10, msg.options?.maxRetries || 3)),
            msg.options?.correlationId || null,
            msg.options?.metadata ? JSON.stringify(msg.options.metadata) : null
          );
          
          messageIds.push(result.lastInsertRowid as number);
        } catch (error) {
          this.logger.error('QueueSystem', 'Failed to enqueue message in batch', {
            queueName: msg.queueName,
            messageType: msg.messageType,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          throw error; // Rollback entire transaction on error
        }
      }
      
      return messageIds;
    });

    try {
      const ids = transaction();
      this.logger.info('QueueSystem', 'Batch enqueue completed', {
        count: ids.length,
        messageIds: ids
      });
      return ids;
    } catch (error) {
      this.logger.error('QueueSystem', 'Batch enqueue failed', error);
      throw new Error(`Failed to enqueue batch: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Dequeue messages for processing (FIXED: Atomic claim with no race condition)
   */
  dequeue(queueName: string, batchSize: number = 1): QueueMessage[] {
    if (this.isShuttingDown) {
      return [];
    }

    const now = Date.now();
    
    // Use different strategies based on SQLite version
    const transaction = this.db.transaction(() => {
      try {
        let messages: QueueMessage[];
        
        if (this.supportsReturning) {
          // Use atomic UPDATE...RETURNING for newer SQLite versions
          const updateStmt = this.getPreparedStatement('dequeue_returning', `
            UPDATE queue_messages 
            SET status = 'processing', processed_at = ?
            WHERE id IN (
              SELECT id FROM queue_messages 
              WHERE queue_name = ? 
                AND status IN ('pending', 'retrying')
                AND scheduled_at <= ?
                AND (next_retry_at IS NULL OR next_retry_at <= ?)
              ORDER BY priority DESC, created_at ASC 
              LIMIT ?
            )
            RETURNING *
          `);

          messages = updateStmt.all(now, queueName, now, now, batchSize) as QueueMessage[];
        } else {
          // Fallback for older SQLite versions - select then update
          const selectStmt = this.getPreparedStatement('dequeue_select', `
            SELECT * FROM queue_messages 
            WHERE queue_name = ? 
              AND status IN ('pending', 'retrying')
              AND scheduled_at <= ?
              AND (next_retry_at IS NULL OR next_retry_at <= ?)
            ORDER BY priority DESC, created_at ASC 
            LIMIT ?
          `);
          
          messages = selectStmt.all(queueName, now, now, batchSize) as QueueMessage[];
          
          if (messages.length > 0) {
            const ids = messages.map(m => m.id);
            const placeholders = ids.map(() => '?').join(',');
            const updateStmt = this.db.prepare(`
              UPDATE queue_messages 
              SET status = 'processing', processed_at = ?
              WHERE id IN (${placeholders})
            `);
            updateStmt.run(now, ...ids);
          }
        }
        
        // Sort messages by priority if RETURNING was used (it doesn't preserve ORDER BY)
        if (this.supportsReturning) {
          messages.sort((a, b) => {
            if (b.priority !== a.priority) {
              return b.priority - a.priority; // Higher priority first
            }
            return a.created_at - b.created_at; // Earlier created first for same priority
          });
        }
        
        // Parse JSON fields
        return messages.map(message => {
          try {
            return {
              ...message,
              payload: typeof message.payload === 'string' ? JSON.parse(message.payload) : message.payload,
              metadata: message.metadata && typeof message.metadata === 'string' 
                ? JSON.parse(message.metadata) 
                : message.metadata
            };
          } catch (error) {
            this.logger.warn('QueueSystem', 'Failed to parse message JSON', { 
              messageId: message.id, 
              error: error instanceof Error ? error.message : 'Unknown error' 
            });
            return message;
          }
        });
      } catch (error) {
        this.logger.error('QueueSystem', 'Failed to dequeue messages', error);
        return [];
      }
    });

    const messages = transaction();
    
    if (messages.length > 0) {
      this.logger.info('QueueSystem', 'Messages dequeued', {
        queueName,
        count: messages.length,
        messageIds: messages.map(m => m.id)
      });
    }

    return messages;
  }

  /**
   * Mark message as completed
   */
  markCompleted(messageId: number): void {
    try {
      const stmt = this.db.prepare(`
        UPDATE queue_messages 
        SET status = 'completed', processed_at = ?
        WHERE id = ? AND status = 'processing'
      `);

      const result = stmt.run(Date.now(), messageId);
      
      if (result.changes > 0) {
        this.logger.info('QueueSystem', 'Message marked as completed', { messageId });
      } else {
        this.logger.warn('QueueSystem', 'Failed to mark message as completed', { messageId });
      }
    } catch (error) {
      this.logger.error('QueueSystem', 'Error marking message as completed', error);
    }
  }

  /**
   * Mark message as failed with exponential backoff retry logic
   */
  markFailed(messageId: number, errorMessage: string): void {
    const now = Date.now();
    
    const transaction = this.db.transaction(() => {
      try {
        // Get current message
        const selectStmt = this.db.prepare('SELECT * FROM queue_messages WHERE id = ?');
        const message = selectStmt.get(messageId) as QueueMessage | undefined;
        
        if (!message) {
          this.logger.warn('QueueSystem', 'Message not found for failure marking', { messageId });
          return;
        }

        // Get queue configuration
        const config = this.getQueueConfig(message.queue_name);
        const newRetryCount = message.retry_count + 1;
        
        if (newRetryCount <= config.maxRetries) {
          // Calculate exponential backoff with jitter
          const retryDelayMs = this.calculateExponentialBackoff(
            newRetryCount, 
            config.baseDelayMs, 
            config.maxDelayMs, 
            config.useJitter,
            config.backoffMultiplier
          );
          const nextRetryAt = now + retryDelayMs;
          
          const updateStmt = this.db.prepare(`
            UPDATE queue_messages 
            SET status = 'retrying', 
                retry_count = ?, 
                error_message = ?,
                next_retry_at = ?
            WHERE id = ?
          `);
          
          updateStmt.run(newRetryCount, errorMessage, nextRetryAt, messageId);
          
          this.logger.info('QueueSystem', 'Message scheduled for retry', {
            messageId,
            retryCount: newRetryCount,
            nextRetryAt,
            delayMs: retryDelayMs
          });
        } else {
          // Move to dead letter queue
          this.moveToDeadLetterQueue(message, errorMessage);
          
          // Mark as failed
          const updateStmt = this.db.prepare(`
            UPDATE queue_messages 
            SET status = 'failed', 
                retry_count = ?, 
                error_message = ?,
                processed_at = ?
            WHERE id = ?
          `);
          
          updateStmt.run(newRetryCount, errorMessage, now, messageId);
          
          this.logger.error('QueueSystem', 'Message moved to dead letter queue', {
            messageId,
            retryCount: newRetryCount,
            errorMessage
          });
        }
      } catch (error) {
        this.logger.error('QueueSystem', 'Error in markFailed transaction', error);
        throw error;
      }
    });

    try {
      transaction();
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to mark message as failed', error);
    }
  }

  /**
   * Calculate exponential backoff with jitter
   */
  private calculateExponentialBackoff(
    retryCount: number, 
    baseDelayMs: number, 
    maxDelayMs: number,
    useJitter: boolean,
    backoffMultiplier: number
  ): number {
    // Calculate exponential delay
    let delay = baseDelayMs * Math.pow(backoffMultiplier, retryCount - 1);
    
    // Add jitter if enabled (±25% randomization)
    if (useJitter) {
      const jitterRange = delay * 0.25;
      const jitter = (Math.random() * 2 - 1) * jitterRange;
      delay += jitter;
    }
    
    // Clamp to max delay
    return Math.min(Math.max(0, delay), maxDelayMs);
  }

  /**
   * Get queue configuration (with caching)
   */
  private queueConfigCache = new Map<string, RetryConfig & QueueProcessorConfig>();
  
  getQueueConfig(queueName: string): RetryConfig & QueueProcessorConfig {
    // Check cache first
    if (this.queueConfigCache.has(queueName)) {
      return this.queueConfigCache.get(queueName)!;
    }

    try {
      const stmt = this.db.prepare('SELECT * FROM queue_configs WHERE queue_name = ?');
      const config = stmt.get(queueName) as any;
      
      if (config) {
        const parsedConfig = {
          maxRetries: config.max_retries,
          baseDelayMs: config.base_delay_ms,
          maxDelayMs: config.max_delay_ms,
          useJitter: !!config.use_jitter,
          backoffMultiplier: config.backoff_multiplier,
          batchSize: config.batch_size,
          processingTimeout: config.processing_timeout,
          cleanupInterval: 5000,
          retentionPeriod: config.retention_period
        };
        
        this.queueConfigCache.set(queueName, parsedConfig);
        return parsedConfig;
      }
    } catch (error) {
      this.logger.warn('QueueSystem', 'Failed to get queue config, using defaults', { queueName, error });
    }

    // Return defaults if no config found
    const defaultConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 300000,
      useJitter: true,
      backoffMultiplier: 2.0,
      batchSize: 10,
      processingTimeout: 30000,
      cleanupInterval: 5000,
      retentionPeriod: 7 * 24 * 60 * 60 * 1000
    };
    
    // Cache the default config
    this.queueConfigCache.set(queueName, defaultConfig);
    return defaultConfig;
  }

  /**
   * Configure a queue
   */
  configureQueue(queueName: string, config: Partial<RetryConfig & QueueProcessorConfig>): void {
    const now = Date.now();
    
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO queue_configs (
          queue_name, max_retries, base_delay_ms, max_delay_ms, use_jitter,
          backoff_multiplier, batch_size, processing_timeout, retention_period,
          enabled, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        queueName,
        config.maxRetries ?? 3,
        config.baseDelayMs ?? 1000,
        config.maxDelayMs ?? 300000,
        (config.useJitter ?? true) ? 1 : 0,
        config.backoffMultiplier ?? 2.0,
        config.batchSize ?? 10,
        config.processingTimeout ?? 30000,
        config.retentionPeriod ?? (7 * 24 * 60 * 60 * 1000),
        1, // enabled
        now,
        now
      );

      // Clear cache for this queue
      this.queueConfigCache.delete(queueName);
      
      this.logger.info('QueueSystem', 'Queue configured', { queueName, config });
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to configure queue', error);
      throw new Error(`Failed to configure queue: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Move message to dead letter queue
   */
  private moveToDeadLetterQueue(message: QueueMessage, errorMessage: string): void {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO dead_letter_queue (
          original_queue_name, original_message_id, payload, error_message,
          retry_count, failed_at, correlation_id, message_type, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        message.queue_name,
        message.id,
        typeof message.payload === 'string' ? message.payload : JSON.stringify(message.payload),
        errorMessage,
        message.retry_count,
        Date.now(),
        message.correlation_id,
        message.message_type,
        typeof message.metadata === 'string' ? message.metadata : JSON.stringify(message.metadata)
      );
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to move message to DLQ', error);
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats(queueName: string): QueueStats {
    try {
      const stmt = this.db.prepare(`
        SELECT 
          status,
          COUNT(*) as count,
          AVG(CASE WHEN processed_at IS NOT NULL AND created_at IS NOT NULL 
               THEN processed_at - created_at END) as avg_processing_time
        FROM queue_messages 
        WHERE queue_name = ?
        GROUP BY status
      `);

      const results = stmt.all(queueName) as Array<{ 
        status: string; 
        count: number; 
        avg_processing_time: number | null 
      }>;
      
      const stats: QueueStats = {
        queueName,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        retrying: 0,
        totalProcessed: 0,
        avgProcessingTime: 0
      };

      let totalTime = 0;
      let timeCount = 0;

      for (const result of results) {
        switch (result.status) {
          case 'pending':
            stats.pending = result.count;
            break;
          case 'processing':
            stats.processing = result.count;
            break;
          case 'completed':
            stats.completed = result.count;
            stats.totalProcessed += result.count;
            break;
          case 'failed':
            stats.failed = result.count;
            stats.totalProcessed += result.count;
            break;
          case 'retrying':
            stats.retrying = result.count;
            break;
        }
        
        if (result.avg_processing_time !== null) {
          totalTime += result.avg_processing_time * result.count;
          timeCount += result.count;
        }
      }

      if (timeCount > 0) {
        stats.avgProcessingTime = totalTime / timeCount;
      }

      return stats;
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to get queue stats', error);
      return {
        queueName,
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        retrying: 0,
        totalProcessed: 0,
        avgProcessingTime: 0
      };
    }
  }

  /**
   * Peek at messages without dequeuing
   */
  peekMessages(queueName: string, limit: number = 10): QueueMessage[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM queue_messages 
        WHERE queue_name = ? 
          AND status IN ('pending', 'retrying')
          AND scheduled_at <= ?
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
        ORDER BY priority DESC, created_at ASC 
        LIMIT ?
      `);

      const now = Date.now();
      const messages = stmt.all(queueName, now, now, limit) as QueueMessage[];
      
      // Parse JSON fields for display
      return messages.map(message => ({
        ...message,
        payload: this.safeJsonParse(message.payload),
        metadata: message.metadata ? this.safeJsonParse(message.metadata) : null
      }));
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to peek messages', error);
      return [];
    }
  }

  /**
   * Safe JSON parse helper
   */
  private safeJsonParse(value: any): any {
    if (typeof value !== 'string') return value;
    
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * Start background cleanup process
   */
  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(() => {
      if (!this.isShuttingDown) {
        this.cleanupOldMessages();
      }
    }, 60000); // Run every minute
  }

  /**
   * Cleanup old completed messages
   */
  private cleanupOldMessages(): void {
    try {
      // Get retention periods for each queue
      const queuesStmt = this.db.prepare(`
        SELECT DISTINCT q.queue_name, COALESCE(c.retention_period, 604800000) as retention_period
        FROM queue_messages q
        LEFT JOIN queue_configs c ON q.queue_name = c.queue_name
      `);
      
      const queues = queuesStmt.all() as Array<{ queue_name: string; retention_period: number }>;
      
      for (const queue of queues) {
        const cutoffTime = Date.now() - queue.retention_period;
        
        const stmt = this.db.prepare(`
          DELETE FROM queue_messages 
          WHERE queue_name = ?
            AND status IN ('completed', 'failed') 
            AND processed_at < ?
        `);
        
        const result = stmt.run(queue.queue_name, cutoffTime);
        
        if (result.changes > 0) {
          this.logger.info('QueueSystem', 'Cleaned up old messages', { 
            queueName: queue.queue_name,
            count: result.changes 
          });
        }
      }
      
      // Also cleanup old dead letter queue entries (30 days retention)
      const dlqCutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const dlqStmt = this.db.prepare('DELETE FROM dead_letter_queue WHERE failed_at < ?');
      const dlqResult = dlqStmt.run(dlqCutoff);
      
      if (dlqResult.changes > 0) {
        this.logger.info('QueueSystem', 'Cleaned up old DLQ messages', { count: dlqResult.changes });
      }
    } catch (error) {
      this.logger.error('QueueSystem', 'Failed to cleanup old messages', error);
    }
  }

  /**
   * Register a queue processor
   */
  registerProcessor(queueName: string, processor: QueueProcessor): void {
    if (this.processors.has(queueName)) {
      this.logger.warn('QueueSystem', 'Processor already registered', { queueName });
      return;
    }
    
    this.processors.set(queueName, processor);
    processor.start();
    this.logger.info('QueueSystem', 'Processor registered', { queueName });
  }

  /**
   * Unregister a queue processor
   */
  unregisterProcessor(queueName: string): void {
    const processor = this.processors.get(queueName);
    if (processor) {
      processor.stop();
      this.processors.delete(queueName);
      this.logger.info('QueueSystem', 'Processor unregistered', { queueName });
    }
  }

  /**
   * Execute a read-only query on the database
   * This method is provided for safe read-only access to the database
   */
  executeQuery<T = any>(sql: string, params: any[] = []): T[] {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as T[];
    } catch (error) {
      this.logger.error('QueueSystem', 'Query execution failed', { sql, error });
      throw error;
    }
  }

  /**
   * Execute a single read-only query that returns one row
   */
  executeQuerySingle<T = any>(sql: string, params: any[] = []): T | undefined {
    try {
      const stmt = this.db.prepare(sql);
      return stmt.get(...params) as T | undefined;
    } catch (error) {
      this.logger.error('QueueSystem', 'Single query execution failed', { sql, error });
      throw error;
    }
  }

  /**
   * Execute a write operation on the database within a transaction
   */
  executeTransaction<T = any>(fn: (db: Database.Database) => T): T {
    try {
      const transaction = this.db.transaction(fn);
      return transaction(this.db);
    } catch (error) {
      this.logger.error('QueueSystem', 'Transaction execution failed', error);
      
      // Ensure any pending transaction is rolled back
      try {
        this.db.exec('ROLLBACK');
      } catch (rollbackError) {
        // Ignore rollback errors as transaction may have already been rolled back
        this.logger.debug('QueueSystem', 'Rollback attempted after transaction error', rollbackError);
      }
      
      // Clear any cached statements that might be in an invalid state
      if (this.preparedStatements.size > 0) {
        this.logger.info('QueueSystem', 'Clearing prepared statements cache after transaction error');
        // Simply clear the cache - better-sqlite3 handles cleanup
        this.preparedStatements.clear();
      }
      
      throw error;
    }
  }

  /**
   * Get all distinct queue names
   */
  getQueueNames(): string[] {
    const stmt = this.db.prepare('SELECT DISTINCT queue_name FROM queue_messages');
    const results = stmt.all() as Array<{ queue_name: string }>;
    return results.map(r => r.queue_name);
  }

  /**
   * Get the current size of a specific queue
   */
  getQueueSize(queueName: string): number {
    const stmt = this.getPreparedStatement('queueSize', `
      SELECT COUNT(*) as count 
      FROM queue_messages 
      WHERE queue_name = ? 
      AND status IN ('pending', 'processing', 'retrying')
    `);
    const result = stmt.get(queueName) as { count: number };
    return result?.count || 0;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    
    // Clear cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    
    // Stop all processors gracefully
    const stopPromises: Promise<void>[] = [];
    for (const [queueName, processor] of this.processors.entries()) {
      this.logger.info('QueueSystem', 'Stopping processor', { queueName });
      stopPromises.push(processor.stop());
    }
    
    await Promise.all(stopPromises);
    this.processors.clear();
    
    // Clear prepared statements cache
    try {
      // Simply clear the cache - better-sqlite3 handles cleanup automatically when DB is closed
      this.preparedStatements.clear();
      this.logger.info('QueueSystem', 'Prepared statements cache cleared');
    } catch (error) {
      this.logger.error('QueueSystem', 'Error clearing prepared statements cache', error);
    }
    
    // Close database connection
    try {
      this.db.close();
      this.logger.info('QueueSystem', 'Database connection closed');
    } catch (error) {
      this.logger.error('QueueSystem', 'Error closing database', error);
    }
  }

  /**
   * Close database connection (deprecated, use shutdown instead)
   * @deprecated Use shutdown() for graceful shutdown
   */
  close(): void {
    this.logger.warn('QueueSystem', 'close() is deprecated, use shutdown() instead');
    this.shutdown().catch(error => {
      this.logger.error('QueueSystem', 'Error during close/shutdown', error);
    });
  }
}

/**
 * Base class for queue processors
 */
export abstract class QueueProcessor {
  protected queueName: string;
  protected queueSystem: QueueSystem;
  protected config: QueueProcessorConfig;
  protected logger = LoggingService.getInstance();
  protected isRunning = false;
  protected processInterval?: NodeJS.Timeout;
  protected activeProcessing = new Set<Promise<void>>();
  protected maxConcurrentProcessing = 10;

  constructor(
    queueName: string,
    config: Partial<QueueProcessorConfig> = {}
  ) {
    this.queueName = queueName;
    this.queueSystem = QueueSystem.getInstance();
    this.config = {
      batchSize: config.batchSize || 10,
      processingTimeout: config.processingTimeout || 30000,
      cleanupInterval: config.cleanupInterval || 5000,
      retentionPeriod: config.retentionPeriod || 7 * 24 * 60 * 60 * 1000
    };
  }

  /**
   * Start the processor
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.processInterval = setInterval(() => {
      this.processMessages().catch(error => {
        this.logger.error('QueueProcessor', 'Error in process loop', error);
      });
    }, this.config.cleanupInterval);

    // Process immediately on start
    this.processMessages().catch(error => {
      this.logger.error('QueueProcessor', 'Error in initial process', error);
    });

    this.logger.info('QueueProcessor', 'Started', { queueName: this.queueName });
  }

  /**
   * Stop the processor gracefully
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = undefined;
    }
    
    // Wait for all active processing to complete
    if (this.activeProcessing.size > 0) {
      this.logger.info('QueueProcessor', 'Waiting for active processing to complete', {
        queueName: this.queueName,
        activeCount: this.activeProcessing.size
      });
      
      try {
        // Wait with timeout to prevent hanging
        await Promise.race([
          Promise.all(Array.from(this.activeProcessing)),
          new Promise<void>((resolve) => setTimeout(() => {
            this.logger.warn('QueueProcessor', 'Timeout waiting for processing to complete', {
              queueName: this.queueName,
              remainingCount: this.activeProcessing.size
            });
            resolve();
          }, 30000)) // 30 second timeout
        ]);
      } catch (error) {
        this.logger.error('QueueProcessor', 'Error waiting for active processing', error);
      }
    }
    
    // Clear any remaining references
    this.activeProcessing.clear();
    
    // Wait for any custom cleanup
    await this.onStop();
    
    this.logger.info('QueueProcessor', 'Stopped', { queueName: this.queueName });
  }

  /**
   * Hook for cleanup on stop (override in subclasses if needed)
   */
  protected async onStop(): Promise<void> {
    // Override in subclasses if cleanup is needed
  }

  /**
   * Process messages from the queue
   */
  private async processMessages(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    // Don't start new processing if we're at capacity
    if (this.activeProcessing.size >= this.maxConcurrentProcessing) {
      this.logger.debug('QueueProcessor', 'At max concurrent processing capacity', {
        queueName: this.queueName,
        activeCount: this.activeProcessing.size
      });
      return;
    }

    try {
      // Calculate how many messages we can process
      const availableSlots = this.maxConcurrentProcessing - this.activeProcessing.size;
      const batchSize = Math.min(this.config.batchSize, availableSlots);
      
      if (batchSize <= 0) {
        return;
      }
      
      const messages = this.queueSystem.dequeue(this.queueName, batchSize);
      
      // Process messages in parallel with timeout and tracking
      const processingPromises = messages.map(message => {
        const promise = this.processMessageWithTimeout(message);
        
        // Track active processing
        this.activeProcessing.add(promise);
        promise.finally(() => {
          this.activeProcessing.delete(promise);
        });
        
        return promise;
      });
      
      await Promise.allSettled(processingPromises);
    } catch (error) {
      this.logger.error('QueueProcessor', 'Error processing messages', error);
    }
  }

  /**
   * Process a single message with timeout
   */
  private async processMessageWithTimeout(message: QueueMessage): Promise<void> {
    try {
      await Promise.race([
        this.processMessage(message),
        new Promise<never>((_, reject) => 
          setTimeout(
            () => reject(new Error(`Processing timeout after ${this.config.processingTimeout}ms`)), 
            this.config.processingTimeout
          )
        )
      ]);
      
      this.queueSystem.markCompleted(message.id!);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('QueueProcessor', 'Message processing failed', {
        messageId: message.id,
        error: errorMessage
      });
      this.queueSystem.markFailed(message.id!, errorMessage);
    }
  }

  /**
   * Abstract method to process a single message
   */
  protected abstract processMessage(message: QueueMessage): Promise<void>;
}