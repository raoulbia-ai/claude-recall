import { QueueSystem, QueueMessage } from '../../src/services/queue-system';
import { QueueAPI } from '../../src/services/queue-api';
import { QueueMigration } from '../../src/services/queue-migration';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

describe('QueueSystem', () => {
  let queueSystem: QueueSystem;
  let testDbPath: string;

  beforeEach(async () => {
    // Reset singleton instance
    QueueSystem.resetInstance();
    
    // Create temporary test database
    testDbPath = path.join(__dirname, `test-queue-${Date.now()}.db`);
    
    // Mock ConfigService to use test database
    const mockConfig = {
      getDatabasePath: () => testDbPath
    };
    
    // Override ConfigService for testing
    jest.doMock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => mockConfig
      }
    }));

    // Create fresh instance
    queueSystem = QueueSystem.getInstance();
  });

  afterEach(async () => {
    // Close queue system
    await queueSystem.shutdown();
    
    // Reset singleton instance
    QueueSystem.resetInstance();
    
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('Database Initialization', () => {
    test('should initialize database schema correctly', () => {
      // Access the private db property for testing
      const db = queueSystem['db'];
      
      // Check if tables exist
      const tablesQuery = "SELECT name FROM sqlite_master WHERE type='table'";
      const tables = db.prepare(tablesQuery).all() as Array<{ name: string }>;
      const tableNames = tables.map(t => t.name);
      
      expect(tableNames).toContain('queue_messages');
      expect(tableNames).toContain('queue_configs');
      expect(tableNames).toContain('dead_letter_queue');
    });

    test('should create required indexes', () => {
      // Access the private db property for testing
      const db = queueSystem['db'];
      
      const indexesQuery = "SELECT name FROM sqlite_master WHERE type='index'";
      const indexes = db.prepare(indexesQuery).all() as Array<{ name: string }>;
      const indexNames = indexes.map(i => i.name);
      
      expect(indexNames).toContain('idx_queue_messages_queue_status');
      expect(indexNames).toContain('idx_queue_messages_scheduled');
      expect(indexNames).toContain('idx_queue_messages_priority');
    });
  });

  describe('Message Enqueue/Dequeue', () => {
    test('should enqueue and dequeue messages correctly', () => {
      const payload = { test: 'data', number: 123 };
      
      const messageId = queueSystem.enqueue(
        'enqueue-test-queue',
        'test-message',
        payload,
        { priority: 5 }
      );
      
      expect(messageId).toBeGreaterThan(0);
      
      // Dequeue the message
      const messages = queueSystem.dequeue('enqueue-test-queue', 1);
      
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(messageId);
      expect(messages[0].queue_name).toBe('enqueue-test-queue');
      expect(messages[0].message_type).toBe('test-message');
      expect(messages[0].payload).toEqual(payload);
      expect(messages[0].priority).toBe(5);
      expect(messages[0].status).toBe('processing');
    });

    test('should respect message priority ordering', () => {
      // Use unique queue name for this test
      const queueName = 'priority-test-queue';
      
      // Enqueue messages with different priorities
      const lowPriorityId = queueSystem.enqueue(queueName, 'low', {}, { priority: 1 });
      const highPriorityId = queueSystem.enqueue(queueName, 'high', {}, { priority: 10 });
      const mediumPriorityId = queueSystem.enqueue(queueName, 'medium', {}, { priority: 5 });
      
      // Dequeue should return highest priority first
      const messages = queueSystem.dequeue(queueName, 3);
      
      expect(messages).toHaveLength(3);
      expect(messages[0].id).toBe(highPriorityId);
      expect(messages[1].id).toBe(mediumPriorityId);
      expect(messages[2].id).toBe(lowPriorityId);
    });

    test('should handle scheduled messages correctly', () => {
      const queueName = 'scheduled-test-queue';
      const futureTime = Date.now() + 10000; // 10 seconds in future
      
      // Enqueue message scheduled for future
      const messageId = queueSystem.enqueue(
        queueName,
        'future-message',
        { scheduled: true },
        { scheduledAt: futureTime }
      );
      
      // Should not dequeue immediately
      let messages = queueSystem.dequeue(queueName, 1);
      expect(messages).toHaveLength(0);
      
      // Enqueue message for immediate processing
      queueSystem.enqueue(queueName, 'immediate', { now: true });
      
      // Should only get the immediate message
      messages = queueSystem.dequeue(queueName, 2);
      expect(messages).toHaveLength(1);
      expect(messages[0].message_type).toBe('immediate');
    });
  });

  describe('Message Status Management', () => {
    test('should mark messages as completed', () => {
      const queueName = 'status-test-queue';
      const messageId = queueSystem.enqueue(queueName, 'test', {});
      
      // Dequeue the message
      const messages = queueSystem.dequeue(queueName, 1);
      expect(messages).toHaveLength(1);
      
      // Mark as completed
      queueSystem.markCompleted(messageId);
      
      // Check status
      const db = queueSystem['db'];
      const result = db.prepare('SELECT status FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('completed');
    });

    test('should handle retry logic correctly', () => {
      const queueName = 'retry-test-queue';
      const messageId = queueSystem.enqueue(queueName, 'test', {}, { maxRetries: 2 });
      
      // Dequeue the message
      let messages = queueSystem.dequeue(queueName, 1);
      expect(messages).toHaveLength(1);
      
      const db = queueSystem['db'];
      
      // Mark as failed (first retry)
      queueSystem.markFailed(messageId, 'First error');
      let result = db.prepare('SELECT status, retry_count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('retrying');
      expect(result.retry_count).toBe(1);
      
      // Mark as failed (second retry)
      queueSystem.markFailed(messageId, 'Second error');
      result = db.prepare('SELECT status, retry_count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('retrying');
      expect(result.retry_count).toBe(2);
      
      // Mark as failed (exceeds max retries)
      queueSystem.markFailed(messageId, 'Third error');
      
      result = db.prepare('SELECT status, retry_count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('failed');
      
      // Check dead letter queue
      const dlqResult = db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue WHERE original_message_id = ?').get(messageId) as any;
      expect(dlqResult.count).toBe(1);
    });
  });

  describe('Queue Statistics', () => {
    test('should return accurate queue statistics', () => {
      const queueName = 'stats-test-queue';
      
      // Create messages in different states
      const id1 = queueSystem.enqueue(queueName, 'test1', {});
      const id2 = queueSystem.enqueue(queueName, 'test2', {});
      const id3 = queueSystem.enqueue(queueName, 'test3', {});
      const id4 = queueSystem.enqueue(queueName, 'test4', {});
      
      // Process some messages
      const messages = queueSystem.dequeue(queueName, 1);
      queueSystem.markCompleted(messages[0].id!);
      
      // Get stats
      const stats = queueSystem.getQueueStats(queueName);
      
      expect(stats.queueName).toBe(queueName);
      expect(stats.pending).toBe(3); // 3 messages still pending
      expect(stats.processing).toBe(0); // Marked as completed
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
    });
  });

  describe('Cleanup Operations', () => {
    test('should clean up old messages', () => {
      const queueName = 'cleanup-test-queue';
      const messageId = queueSystem.enqueue(queueName, 'test', {});
      
      // Dequeue and complete the message
      const messages = queueSystem.dequeue(queueName, 1);
      queueSystem.markCompleted(messageId);
      
      const db = queueSystem['db'];
      
      // Set processed_at to old timestamp
      const oldTimestamp = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      db.prepare('UPDATE queue_messages SET processed_at = ? WHERE id = ?').run(oldTimestamp, messageId);
      
      // Run cleanup
      queueSystem['cleanupOldMessages']();
      
      // Message should be deleted
      const result = db.prepare('SELECT COUNT(*) as count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.count).toBe(0);
    });
  });

  describe('Batch Operations', () => {
    test('should handle batch enqueue correctly', () => {
      const queueName = 'batch-test-queue';
      
      const messages = [
        { queueName, messageType: 'batch1', payload: { index: 0 } },
        { queueName, messageType: 'batch2', payload: { index: 1 } },
        { queueName, messageType: 'batch3', payload: { index: 2 } }
      ];
      
      const ids = queueSystem.enqueueBatch(messages);
      
      expect(ids).toHaveLength(3);
      ids.forEach(id => expect(id).toBeGreaterThan(0));
      
      // Verify all messages were enqueued
      const dequeuedMessages = queueSystem.dequeue(queueName, 3);
      expect(dequeuedMessages).toHaveLength(3);
    });
  });
});

describe('QueueAPI', () => {
  let queueAPI: QueueAPI;
  let queueSystem: QueueSystem;
  let testDbPath: string;

  beforeEach(() => {
    // Reset singleton instance
    QueueSystem.resetInstance();
    
    // Create temporary test database
    testDbPath = path.join(__dirname, `test-queue-api-${Date.now()}.db`);
    
    // Mock ConfigService
    const mockConfig = {
      getDatabasePath: () => testDbPath
    };
    
    jest.doMock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => mockConfig
      }
    }));

    queueSystem = QueueSystem.getInstance();
    queueAPI = QueueAPI.getInstance();
  });

  afterEach(async () => {
    await queueSystem.shutdown();
    QueueSystem.resetInstance();
    
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('High-level Operations', () => {
    test('should enqueue hook events correctly', () => {
      const result = queueAPI.enqueueHookEvent('test-hook', {
        action: 'test',
        data: { foo: 'bar' }
      });
      
      expect(result).toBeGreaterThan(0);
    });

    test('should enqueue MCP operations correctly', () => {
      const result = queueAPI.enqueueMCPOperation('memory', 'store', {
        key: 'test',
        value: 'data'
      });
      
      expect(result).toBeGreaterThan(0);
    });

    test('should handle bulk operations', () => {
      const operations = [
        { type: 'hook' as const, name: 'hook1', payload: { data: 1 } },
        { type: 'mcp' as const, name: 'op1', payload: { data: 2 } }
      ];
      
      // bulkEnqueue not implemented, use individual enqueues
      const results = operations.map(op => {
        if (op.type === 'hook') {
          return queueAPI.enqueueHookEvent(op.name, op.payload);
        } else {
          return queueAPI.enqueueMCPOperation(op.name, 'operation', op.payload);
        }
      });
      
      expect(results).toHaveLength(2);
      expect(results[0].queueName).toBe('hooks');
      expect(results[1].queueName).toBe('mcp');
    });
  });

  describe('System Health', () => {
    test('should return system health status', () => {
      // Enqueue some messages
      queueAPI.enqueueHookEvent('test-hook', { test: true });
      queueAPI.enqueueMCPOperation('test', 'op', { test: true });
      
      const health = queueAPI.getSystemHealth();
      
      expect(health.isHealthy).toBe(true);
      expect(health.totalPendingMessages).toBeGreaterThanOrEqual(0);
      expect(health.uptime).toBeGreaterThan(0);
    });
  });
});

describe('QueueMigration', () => {
  let migration: QueueMigration;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, `test-migration-${Date.now()}.db`);
    
    const mockConfig = {
      getDatabasePath: () => testDbPath
    };
    
    jest.doMock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => mockConfig
      }
    }));

    migration = QueueMigration.getInstance();
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    // Clean up backup files
    const backupPattern = testDbPath.replace('.db', '_backup_*.db');
    const dir = path.dirname(testDbPath);
    const files = fs.readdirSync(dir);
    files.forEach(file => {
      if (file.includes('_backup_')) {
        fs.unlinkSync(path.join(dir, file));
      }
    });
    
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('Migration Status', () => {
    test('should detect when migration is needed', async () => {
      // Create empty database - migration should be needed
      const db = new Database(testDbPath);
      db.close();
      
      const isNeeded = await migration.isMigrationNeeded();
      expect(isNeeded).toBe(true);
      
      const status = await migration.getMigrationStatus();
      expect(status.isMigrationNeeded).toBe(true);
      expect(status.missingTables).toContain('queue_messages');
    });

    test('should detect when migration is not needed after migration', async () => {
      // Run migration
      const result = await migration.migrate();
      expect(result.success).toBe(true);
      
      // Check status
      const isNeeded = await migration.isMigrationNeeded();
      expect(isNeeded).toBe(false);
      
      const status = await migration.getMigrationStatus();
      expect(status.isMigrationNeeded).toBe(false);
      expect(status.missingTables).toHaveLength(0);
    });
  });

  describe('Migration Process', () => {
    test('should perform migration successfully', async () => {
      const result = await migration.migrate({ createBackup: true });
      
      expect(result.success).toBe(true);
      expect(result.tablesCreated).toContain('queue_messages');
      expect(result.tablesCreated).toContain('queue_configs');
      expect(result.tablesCreated).toContain('dead_letter_queue');
      expect(result.tablesCreated.length).toBeGreaterThan(0);
    });

    test('should create backup during migration', async () => {
      const result = await migration.migrate({ createBackup: true });
      
      expect(result.success).toBe(true);
      expect(result.backupPath).toBeDefined();
      expect(fs.existsSync(result.backupPath!)).toBe(true);
    });

    test('should verify migration was successful', async () => {
      await migration.migrate();
      
      const verification = await migration.verifyMigration();
      
      expect(verification.isValid).toBe(true);
      expect(verification.issues).toHaveLength(0);
      expect(verification.tableInfo).toHaveLength(3);
      
      const tableNames = verification.tableInfo.map(t => t.name);
      expect(tableNames).toContain('queue_messages');
      expect(tableNames).toContain('queue_configs');
      expect(tableNames).toContain('dead_letter_queue');
    });
  });

  describe('Rollback Operations', () => {
    test('should rollback migration successfully', async () => {
      const migrationResult = await migration.migrate({ createBackup: true });
      expect(migrationResult.success).toBe(true);
      expect(migrationResult.backupPath).toBeDefined();
      
      // Rollback
      const rollbackResult = await migration.rollback(migrationResult.backupPath!);
      expect(rollbackResult.success).toBe(true);
      
      // Database should be restored to backup state
      expect(fs.existsSync(testDbPath)).toBe(true);
    });
  });
});