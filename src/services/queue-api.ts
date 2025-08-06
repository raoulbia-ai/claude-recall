import { QueueSystem, QueueMessage, QueueStats, QueueProcessor } from './queue-system';
import { LoggingService } from './logging';

/**
 * High-level API for queue operations
 * Provides a simplified interface for common queue operations
 */
export class QueueAPI {
  private static instance: QueueAPI;
  private queueSystem: QueueSystem;
  private logger = LoggingService.getInstance();

  private constructor() {
    this.queueSystem = QueueSystem.getInstance();
  }

  static getInstance(): QueueAPI {
    if (!QueueAPI.instance) {
      QueueAPI.instance = new QueueAPI();
    }
    return QueueAPI.instance;
  }

  /**
   * Enqueue a hook event for processing
   */
  enqueueHookEvent(
    eventType: string,
    payload: any,
    options: {
      priority?: number;
      delayMs?: number;
      correlationId?: string;
      maxRetries?: number;
    } = {}
  ): number {
    const scheduledAt = options.delayMs ? Date.now() + options.delayMs : undefined;
    
    return this.queueSystem.enqueue(
      'hook-events',
      eventType,
      payload,
      {
        priority: options.priority || 0,
        scheduledAt,
        maxRetries: options.maxRetries || 3,
        correlationId: options.correlationId,
        metadata: {
          source: 'hook',
          eventType
        }
      }
    );
  }

  /**
   * Enqueue an MCP tool operation for processing
   */
  enqueueMCPOperation(
    toolName: string,
    operation: string,
    payload: any,
    options: {
      priority?: number;
      delayMs?: number;
      correlationId?: string;
      maxRetries?: number;
    } = {}
  ): number {
    const scheduledAt = options.delayMs ? Date.now() + options.delayMs : undefined;
    
    return this.queueSystem.enqueue(
      'mcp-operations',
      `${toolName}:${operation}`,
      payload,
      {
        priority: options.priority || 0,
        scheduledAt,
        maxRetries: options.maxRetries || 5, // MCP operations get more retries
        correlationId: options.correlationId,
        metadata: {
          source: 'mcp',
          toolName,
          operation
        }
      }
    );
  }

  /**
   * Enqueue a memory operation for processing
   */
  enqueueMemoryOperation(
    operation: 'store' | 'search' | 'update' | 'delete',
    payload: any,
    options: {
      priority?: number;
      delayMs?: number;
      correlationId?: string;
      maxRetries?: number;
    } = {}
  ): number {
    const scheduledAt = options.delayMs ? Date.now() + options.delayMs : undefined;
    
    return this.queueSystem.enqueue(
      'memory-operations',
      operation,
      payload,
      {
        priority: options.priority || 0,
        scheduledAt,
        maxRetries: options.maxRetries || 3,
        correlationId: options.correlationId,
        metadata: {
          source: 'memory',
          operation
        }
      }
    );
  }

  /**
   * Enqueue a pattern detection task
   */
  enqueuePatternDetection(
    content: string,
    context: any,
    options: {
      priority?: number;
      delayMs?: number;
      correlationId?: string;
      maxRetries?: number;
    } = {}
  ): number {
    const scheduledAt = options.delayMs ? Date.now() + options.delayMs : undefined;
    
    return this.queueSystem.enqueue(
      'pattern-detection',
      'detect-patterns',
      {
        content,
        context
      },
      {
        priority: options.priority || 0,
        scheduledAt,
        maxRetries: options.maxRetries || 2,
        correlationId: options.correlationId,
        metadata: {
          source: 'pattern-detector',
          contentLength: content.length
        }
      }
    );
  }

  /**
   * Peek at pending messages in a queue without removing them
   */
  peekMessages(queueName: string, limit: number = 10): QueueMessage[] {
    // Use the proper accessor method for database queries
    const now = Date.now();
    const messages = this.queueSystem.executeQuery<QueueMessage>(`
      SELECT * FROM queue_messages 
      WHERE queue_name = ? 
        AND status IN ('pending', 'retrying')
        AND scheduled_at <= ?
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY priority DESC, created_at ASC 
      LIMIT ?
    `, [queueName, now, now, limit]);
    
    // Parse JSON fields for display
    return messages.map(message => ({
      ...message,
      payload: this.safeJsonParse(message.payload),
      metadata: message.metadata ? this.safeJsonParse(message.metadata) : null
    }));
  }

  /**
   * Get queue statistics for monitoring
   */
  getQueueStats(queueName?: string): QueueStats | QueueStats[] {
    if (queueName) {
      return this.queueSystem.getQueueStats(queueName);
    }

    // Get stats for all queues using proper accessor method
    const queueNames = this.queueSystem.getQueueNames();
    
    return queueNames.map(name => this.queueSystem.getQueueStats(name));
  }

  /**
   * Get dead letter queue messages
   */
  getDeadLetterMessages(limit: number = 50): any[] {
    const messages = this.queueSystem.executeQuery<any>(`
      SELECT * FROM dead_letter_queue 
      ORDER BY failed_at DESC 
      LIMIT ?
    `, [limit]);
    
    // Parse JSON fields
    return messages.map(message => ({
      ...message,
      payload: this.safeJsonParse(message.payload),
      metadata: message.metadata ? this.safeJsonParse(message.metadata) : null
    }));
  }

  /**
   * Requeue messages from dead letter queue
   */
  requeueFromDeadLetter(messageIds: number[]): number {
    let requeuedCount = 0;
    
    this.queueSystem.executeTransaction((db) => {
      const selectStmt = db.prepare('SELECT * FROM dead_letter_queue WHERE id = ?');
      const deleteStmt = db.prepare('DELETE FROM dead_letter_queue WHERE id = ?');
      
      for (const messageId of messageIds) {
        const dlqMessage = selectStmt.get(messageId) as any;
        if (dlqMessage) {
          // Re-enqueue the message
          this.queueSystem.enqueue(
            dlqMessage.original_queue_name,
            dlqMessage.message_type,
            this.safeJsonParse(dlqMessage.payload),
            {
              correlationId: dlqMessage.correlation_id,
              metadata: dlqMessage.metadata ? this.safeJsonParse(dlqMessage.metadata) : undefined
            }
          );
          
          // Remove from dead letter queue
          deleteStmt.run(messageId);
          requeuedCount++;
        }
      }
    });
    
    this.logger.info('QueueAPI', 'Messages requeued from dead letter queue', {
      count: requeuedCount,
      requestedCount: messageIds.length
    });
    
    return requeuedCount;
  }

  /**
   * Purge old completed messages manually
   */
  purgeCompletedMessages(olderThanDays: number = 1): number {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    let deletedCount = 0;
    this.queueSystem.executeTransaction((db) => {
      const stmt = db.prepare(`
        DELETE FROM queue_messages 
        WHERE status = 'completed' 
          AND processed_at < ?
      `);
      
      const result = stmt.run(cutoffTime);
      deletedCount = result.changes as number;
    });
    
    this.logger.info('QueueAPI', 'Purged completed messages', {
      count: deletedCount,
      olderThanDays
    });
    
    return deletedCount;
  }

  /**
   * Register a processor for a queue
   */
  registerProcessor(queueName: string, processor: QueueProcessor): void {
    this.queueSystem.registerProcessor(queueName, processor);
  }

  /**
   * Get overall system health
   */
  getSystemHealth(): {
    isHealthy: boolean;
    totalPendingMessages: number;
    totalProcessingMessages: number;
    totalFailedMessages: number;
    deadLetterCount: number;
    uptime: number;
  } {
    // Get message counts by status
    const statusCounts = this.queueSystem.executeQuery<{ status: string; count: number }>(`
      SELECT status, COUNT(*) as count 
      FROM queue_messages 
      GROUP BY status
    `);
    
    // Get dead letter count
    const dlqResult = this.queueSystem.executeQuerySingle<{ count: number }>(
      'SELECT COUNT(*) as count FROM dead_letter_queue'
    );
    const dlqCount = dlqResult?.count || 0;
    
    const stats = {
      pending: 0,
      processing: 0,
      failed: 0
    };
    
    for (const { status, count } of statusCounts) {
      if (status in stats) {
        (stats as any)[status] = count;
      }
    }
    
    // System is considered healthy if there are no stuck processing messages
    // and failed messages are under control
    const isHealthy = stats.processing < 100 && stats.failed < 1000;
    
    return {
      isHealthy,
      totalPendingMessages: stats.pending,
      totalProcessingMessages: stats.processing,
      totalFailedMessages: stats.failed,
      deadLetterCount: dlqCount,
      uptime: process.uptime() * 1000 // Convert to milliseconds
    };
  }

  /**
   * Safely parse JSON with fallback
   */
  private safeJsonParse(jsonString: any): any {
    if (typeof jsonString !== 'string') {
      return jsonString;
    }
    
    try {
      return JSON.parse(jsonString);
    } catch {
      return jsonString; // Return as-is if parsing fails
    }
  }

  /**
   * Close the queue system
   */
  close(): void {
    this.queueSystem.close();
  }
}

/**
 * Factory functions for creating common queue processors
 */
export class QueueProcessorFactory {
  /**
   * Create a hook event processor
   */
  static createHookEventProcessor(): HookEventProcessor {
    return new HookEventProcessor();
  }

  /**
   * Create an MCP operation processor
   */
  static createMCPProcessor(): MCPOperationProcessor {
    return new MCPOperationProcessor();
  }

  /**
   * Create a memory operation processor
   */
  static createMemoryProcessor(): MemoryOperationProcessor {
    return new MemoryOperationProcessor();
  }

  /**
   * Create a pattern detection processor
   */
  static createPatternProcessor(): PatternDetectionProcessor {
    return new PatternDetectionProcessor();
  }
}

/**
 * Hook event processor implementation
 */
class HookEventProcessor extends QueueProcessor {
  constructor() {
    super('hook-events', {
      batchSize: 5,
      processingTimeout: 15000,
      cleanupInterval: 2000
    });
  }

  protected async processMessage(message: QueueMessage): Promise<void> {
    this.logger.info('HookEventProcessor', 'Processing hook event', {
      messageId: message.id,
      messageType: message.message_type,
      correlationId: message.correlation_id
    });

    // Process the hook event based on its type
    switch (message.message_type) {
      case 'tool-use':
        await this.processToolUseEvent(message.payload);
        break;
      case 'user-prompt':
        await this.processUserPromptEvent(message.payload);
        break;
      case 'claude-response':
        await this.processClaudeResponseEvent(message.payload);
        break;
      default:
        this.logger.warn('HookEventProcessor', 'Unknown event type', {
          messageType: message.message_type
        });
    }
  }

  private async processToolUseEvent(payload: any): Promise<void> {
    // Import here to avoid circular dependencies
    const { MemoryService } = await import('./memory');
    const memoryService = MemoryService.getInstance();
    
    memoryService.storeToolUse(
      payload.toolName,
      payload.toolInput,
      payload.context || {}
    );
  }

  private async processUserPromptEvent(payload: any): Promise<void> {
    // Import here to avoid circular dependencies
    const { PreferenceExtractor } = await import('./preference-extractor');
    const { MemoryService } = await import('./memory');
    
    const preferenceExtractor = new PreferenceExtractor();
    const memoryService = MemoryService.getInstance();
    
    // Extract preferences from user prompt (handle both 'content' and 'prompt' fields)
    const promptContent = payload.content || payload.prompt;
    if (!promptContent) {
      this.logger.warn('HookEventProcessor', 'No prompt content found in payload', payload);
      return;
    }
    
    const preferences = preferenceExtractor.extractPreferences(promptContent);
    
    // Store each extracted preference
    for (const preference of preferences) {
      if (preference.confidence >= 0.6) { // Only store high-confidence preferences
        await memoryService.store({
          key: preference.key,
          value: JSON.stringify({
            value: preference.value,
            raw: preference.raw,
            confidence: preference.confidence,
            isOverride: preference.isOverride,
            overrideSignals: preference.overrideSignals,
            source: 'automatic-extraction'
          }),
          type: 'preference',
          context: {
            timestamp: Date.now(),
            type: 'preference-extraction',
            tool: 'PreferenceExtractor'
          }
        });
        
        this.logger.info('HookEventProcessor', 'Preference extracted and stored', {
          key: preference.key,
          value: preference.value,
          confidence: preference.confidence,
          isOverride: preference.isOverride
        });
      }
    }
    
    // Also run legacy pattern detection as fallback
    const { PatternService } = await import('./pattern-service');
    const patternService = PatternService.getInstance();
    const patterns = patternService.analyzePrompt(promptContent);
    
    if (patterns) {
      memoryService.store({
        key: `pattern-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        value: patterns,
        type: 'detected-pattern',
        context: payload.context || {}
      });
    }
  }

  private async processClaudeResponseEvent(payload: any): Promise<void> {
    // Process Claude's response for pattern detection and learning
    const { PatternService } = await import('./pattern-service');
    const patternService = PatternService.getInstance();
    
    // Analyze the response for patterns
    const patterns = patternService.analyzePrompt(payload.content);
    
    // Store the analyzed patterns if they exist
    if (patterns) {
      const { MemoryService } = await import('./memory');
      const memoryService = MemoryService.getInstance();
      
      memoryService.store({
        key: `response-pattern-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        value: patterns,
        type: 'response-pattern',
        context: payload.context || {}
      });
    }
  }
}

/**
 * MCP operation processor implementation
 */
class MCPOperationProcessor extends QueueProcessor {
  constructor() {
    super('mcp-operations', {
      batchSize: 3,
      processingTimeout: 30000,
      cleanupInterval: 3000
    });
  }

  protected async processMessage(message: QueueMessage): Promise<void> {
    this.logger.info('MCPOperationProcessor', 'Processing MCP operation', {
      messageId: message.id,
      messageType: message.message_type,
      correlationId: message.correlation_id
    });

    const [toolName, operation] = message.message_type.split(':');
    
    // Route to appropriate MCP tool handler
    switch (toolName) {
      case 'memory':
        await this.processMemoryTool(operation, message.payload);
        break;
      case 'search':
        await this.processSearchTool(operation, message.payload);
        break;
      case 'pattern':
        await this.processPatternTool(operation, message.payload);
        break;
      default:
        this.logger.warn('MCPOperationProcessor', 'Unknown tool', { toolName });
    }
  }

  private async processMemoryTool(operation: string, payload: any): Promise<void> {
    const { MemoryService } = await import('./memory');
    const memoryService = MemoryService.getInstance();
    
    switch (operation) {
      case 'store':
        memoryService.store(payload);
        break;
      case 'search':
        memoryService.search(payload.query);
        break;
      default:
        this.logger.warn('MCPOperationProcessor', 'Unknown memory operation', { operation });
    }
  }

  private async processSearchTool(operation: string, payload: any): Promise<void> {
    // Implement search tool operations
    this.logger.info('MCPOperationProcessor', 'Processing search operation', { operation, payload });
  }

  private async processPatternTool(operation: string, payload: any): Promise<void> {
    // Implement pattern tool operations
    this.logger.info('MCPOperationProcessor', 'Processing pattern operation', { operation, payload });
  }
}

/**
 * Memory operation processor implementation
 */
class MemoryOperationProcessor extends QueueProcessor {
  constructor() {
    super('memory-operations', {
      batchSize: 10,
      processingTimeout: 10000,
      cleanupInterval: 1000
    });
  }

  protected async processMessage(message: QueueMessage): Promise<void> {
    this.logger.info('MemoryOperationProcessor', 'Processing memory operation', {
      messageId: message.id,
      messageType: message.message_type,
      correlationId: message.correlation_id
    });

    const { MemoryService } = await import('./memory');
    const memoryService = MemoryService.getInstance();
    
    switch (message.message_type) {
      case 'store':
        memoryService.store(message.payload);
        break;
      case 'search':
        memoryService.search(message.payload.query);
        break;
      case 'update':
        // Implement update logic
        break;
      case 'delete':
        // Implement delete logic
        break;
      default:
        this.logger.warn('MemoryOperationProcessor', 'Unknown operation', {
          messageType: message.message_type
        });
    }
  }
}

/**
 * Pattern detection processor implementation
 */
class PatternDetectionProcessor extends QueueProcessor {
  constructor() {
    super('pattern-detection', {
      batchSize: 5,
      processingTimeout: 20000,
      cleanupInterval: 3000
    });
  }

  protected async processMessage(message: QueueMessage): Promise<void> {
    this.logger.info('PatternDetectionProcessor', 'Processing pattern detection', {
      messageId: message.id,
      correlationId: message.correlation_id,
      contentLength: message.payload.content?.length
    });

    const { PatternService } = await import('./pattern-service');
    const patternService = PatternService.getInstance();
    
    // Analyze the content for patterns
    const patterns = patternService.analyzePrompt(message.payload.content);
    
    // Store the analyzed patterns if they exist
    if (patterns) {
      const { MemoryService } = await import('./memory');
      const memoryService = MemoryService.getInstance();
      
      memoryService.store({
        key: `pattern-detection-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        value: patterns,
        type: 'pattern-analysis',
        context: message.payload.context || {}
      });
    }
  }
}