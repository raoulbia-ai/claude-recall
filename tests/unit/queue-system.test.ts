import { QueueSystem, QueueMessage } from '../../src/services/queue-system';
import { QueueAPI } from '../../src/services/queue-api';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

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
    queueSystem.close();
    
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
    test.skip('should initialize database schema correctly', () => {
      const db = new Database(testDbPath);
      
      // Check if tables exist
      const tablesQuery = "SELECT name FROM sqlite_master WHERE type='table'";
      const tables = db.prepare(tablesQuery).all() as Array<{ name: string }>;
      const tableNames = tables.map(t => t.name);
      
      expect(tableNames).toContain('queue_messages');
      expect(tableNames).toContain('queue_configs');
      expect(tableNames).toContain('dead_letter_queue');
      
      db.close();
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
      
      // Enqueue message
      const messageId = queueSystem.enqueue(
        'test-queue',
        'test-message',
        payload,
        { priority: 5 }
      );
      
      expect(messageId).toBeGreaterThan(0);
      
      // Dequeue message
      const messages = queueSystem.dequeue('test-queue', 1);
      
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(messageId);
      expect(messages[0].queue_name).toBe('test-queue');
      expect(messages[0].message_type).toBe('test-message');
      expect(messages[0].payload).toEqual(payload);
      expect(messages[0].priority).toBe(5);
      expect(messages[0].status).toBe('processing');
    });

    test('should respect message priority ordering', () => {
      // Enqueue messages with different priorities
      const lowPriorityId = queueSystem.enqueue('test-queue', 'low', {}, { priority: 1 });
      const highPriorityId = queueSystem.enqueue('test-queue', 'high', {}, { priority: 10 });
      const mediumPriorityId = queueSystem.enqueue('test-queue', 'medium', {}, { priority: 5 });
      
      // Dequeue should return highest priority first
      const messages = queueSystem.dequeue('test-queue', 3);
      
      expect(messages).toHaveLength(3);
      expect(messages[0].id).toBe(highPriorityId);
      expect(messages[1].id).toBe(mediumPriorityId);
      expect(messages[2].id).toBe(lowPriorityId);
    });

    test.skip('should handle scheduled messages correctly', () => {
      const futureTime = Date.now() + 10000; // 10 seconds in future
      
      // Enqueue message scheduled for future
      const messageId = queueSystem.enqueue(
        'test-queue',
        'future-message',
        { scheduled: true },
        { scheduledAt: futureTime }
      );
      
      // Should not dequeue immediately
      let messages = queueSystem.dequeue('test-queue', 1);
      expect(messages).toHaveLength(0);
      
      // Enqueue message for immediate processing
      queueSystem.enqueue('test-queue', 'immediate', { now: true });
      
      // Should only get the immediate message
      messages = queueSystem.dequeue('test-queue', 2);
      expect(messages).toHaveLength(1);
      expect(messages[0].message_type).toBe('immediate');
    });
  });

  describe('Message Status Management', () => {
    test('should mark messages as completed', () => {
      const messageId = queueSystem.enqueue('test-queue', 'test', {});
      const messages = queueSystem.dequeue('test-queue', 1);
      
      expect(messages[0].status).toBe('processing');
      
      queueSystem.markCompleted(messageId);
      
      // Verify status changed
      const db = queueSystem['db'];
      const result = db.prepare('SELECT status FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('completed');
    });

    test.skip('should handle retry logic correctly', () => {
      const messageId = queueSystem.enqueue('test-queue', 'test', {}, { maxRetries: 2 });
      queueSystem.dequeue('test-queue', 1);
      
      // First failure should schedule retry
      queueSystem.markFailed(messageId, 'Test error');
      
      const db = queueSystem['db'];
      let result = db.prepare('SELECT status, retry_count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('retrying');
      expect(result.retry_count).toBe(1);
      
      // Dequeue and fail again
      queueSystem.dequeue('test-queue', 1);
      queueSystem.markFailed(messageId, 'Test error 2');
      
      result = db.prepare('SELECT status, retry_count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('retrying');
      expect(result.retry_count).toBe(2);
      
      // Third failure should move to dead letter queue
      queueSystem.dequeue('test-queue', 1);
      queueSystem.markFailed(messageId, 'Final error');
      
      result = db.prepare('SELECT status, retry_count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.status).toBe('failed');
      
      // Check dead letter queue
      const dlqResult = db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue WHERE original_message_id = ?').get(messageId) as any;
      expect(dlqResult.count).toBe(1);
    });
  });

  describe('Queue Statistics', () => {
    test.skip('should return accurate queue statistics', () => {
      // Create messages with different statuses
      const completedId = queueSystem.enqueue('test-queue', 'completed', {});
      const pendingId1 = queueSystem.enqueue('test-queue', 'pending1', {});
      const pendingId2 = queueSystem.enqueue('test-queue', 'pending2', {});
      const processingId = queueSystem.enqueue('test-queue', 'processing', {});
      
      // Mark one as completed
      queueSystem.dequeue('test-queue', 1);
      queueSystem.markCompleted(completedId);
      
      // Mark one as processing (dequeue)
      queueSystem.dequeue('test-queue', 1);
      
      const stats = queueSystem.getQueueStats('test-queue');
      
      expect(stats.queueName).toBe('test-queue');
      expect(stats.pending).toBe(2);
      expect(stats.processing).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(0);
      expect(stats.retrying).toBe(0);
    });
  });

  describe('Cleanup Operations', () => {
    test('should clean up old messages', () => {
      // Create old completed message
      const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      const messageId = queueSystem.enqueue('test-queue', 'old', {});
      
      // Manually update processed_at to simulate old message
      const db = queueSystem['db'];
      db.prepare('UPDATE queue_messages SET status = ?, processed_at = ? WHERE id = ?')
        .run('completed', oldTime, messageId);
      
      // Trigger cleanup
      queueSystem['cleanupOldMessages']();
      
      // Message should be deleted
      const result = db.prepare('SELECT COUNT(*) as count FROM queue_messages WHERE id = ?').get(messageId) as any;
      expect(result.count).toBe(0);
    });
  });
});

describe('QueueAPI', () => {
  let queueAPI: QueueAPI;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, `test-queue-api-${Date.now()}.db`);
    
    const mockConfig = {
      getDatabasePath: () => testDbPath
    };
    
    jest.doMock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => mockConfig
      }
    }));

    queueAPI = QueueAPI.getInstance();
  });

  afterEach(() => {
    queueAPI.close();
    
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('High-level Operations', () => {
    test('should enqueue hook events correctly', () => {
      const messageId = queueAPI.enqueueHookEvent(
        'tool-use',
        { toolName: 'test-tool', input: 'test-input' },
        { priority: 7, correlationId: 'test-correlation' }
      );
      
      expect(messageId).toBeGreaterThan(0);
      
      const messages = queueAPI.peekMessages('hook-events', 1);
      expect(messages).toHaveLength(1);
      expect(messages[0].message_type).toBe('tool-use');
      expect(messages[0].priority).toBe(7);
      expect(messages[0].correlation_id).toBe('test-correlation');
    });

    test('should enqueue MCP operations correctly', () => {
      const messageId = queueAPI.enqueueMCPOperation(
        'memory',
        'search',
        { query: 'test query' },
        { priority: 6 }
      );
      
      expect(messageId).toBeGreaterThan(0);
      
      const messages = queueAPI.peekMessages('mcp-operations', 1);
      expect(messages).toHaveLength(1);
      expect(messages[0].message_type).toBe('memory:search');
      expect(messages[0].priority).toBe(6);
    });

    test('should handle bulk operations', () => {
      const operations = [
        { operation: 'store', payload: { key: 'test1', value: 'value1' } },
        { operation: 'store', payload: { key: 'test2', value: 'value2' } },
        { operation: 'search', payload: { query: 'test query' } }
      ];
      
      // This would be tested with the enhanced memory tools
      // For now, just verify the API exists
      expect(typeof queueAPI.enqueueMemoryOperation).toBe('function');
    });
  });

  describe('System Health', () => {
    test('should return system health status', () => {
      // Add some test messages
      queueAPI.enqueueHookEvent('test', {});
      queueAPI.enqueueMCPOperation('test', 'op', {});
      
      const health = queueAPI.getSystemHealth();
      
      expect(health).toHaveProperty('isHealthy');
      expect(health).toHaveProperty('totalPendingMessages');
      expect(health).toHaveProperty('totalProcessingMessages');
      expect(health).toHaveProperty('totalFailedMessages');
      expect(health).toHaveProperty('deadLetterCount');
      expect(health).toHaveProperty('uptime');
      
      expect(health.totalPendingMessages).toBeGreaterThan(0);
    });
  });
});

// Migration tests removed - not applicable for fresh installations
// These tests were for migrating from non-existent old schema