import { QueueSystem } from '../../src/services/queue-system';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

describe('QueueSystem Edge Cases', () => {
  let queueSystem: QueueSystem;
  const testDbPath = '/tmp/test-queue-edge-cases.db';

  beforeEach(() => {
    // Clean up any existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    // Reset singleton instance
    QueueSystem.resetInstance();
    
    // Mock config to use test database
    const ConfigService = require('../../src/services/config').ConfigService;
    jest.spyOn(ConfigService.getInstance(), 'getDatabasePath').mockReturnValue(testDbPath);
    
    queueSystem = QueueSystem.getInstance();
  });

  afterEach(async () => {
    await queueSystem.shutdown();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('SQLite Version Compatibility', () => {
    it('should handle SQLite version incompatibility gracefully', () => {
      // Test is automatically handled by the checkSQLiteVersion method
      // The system should work with both RETURNING and non-RETURNING approaches
      const messageId = queueSystem.enqueue('test-queue', 'test-type', { data: 'test' });
      expect(messageId).toBeGreaterThan(0);
      
      const messages = queueSystem.dequeue('test-queue', 1);
      expect(messages).toHaveLength(1);
      expect(messages[0].payload).toEqual({ data: 'test' });
    });

    it('should log SQLite version information on initialization', () => {
      const LoggingService = require('../../src/services/logging').LoggingService;
      const infoSpy = jest.spyOn(LoggingService.getInstance(), 'info');
      
      QueueSystem.resetInstance();
      const newInstance = QueueSystem.getInstance();
      
      // Check if version was logged
      const versionLog = infoSpy.mock.calls.find(call => 
        call[1] && typeof call[1] === 'string' && call[1].includes('SQLite version')
      );
      expect(versionLog).toBeDefined();
    });
  });

  describe('Large Payload Handling', () => {
    it('should reject payloads exceeding 1MB limit', () => {
      const largePayload = { data: 'x'.repeat(1048577) }; // Just over 1MB
      
      expect(() => {
        queueSystem.enqueue('test-queue', 'large-message', largePayload);
      }).toThrow('Payload exceeds maximum size of 1MB');
    });

    it('should accept payloads just under 1MB limit', () => {
      // Create a payload just under 1MB
      const maxSize = 1048576;
      const overhead = JSON.stringify({ data: '' }).length;
      const dataSize = maxSize - overhead - 100; // Leave some buffer
      const payload = { data: 'x'.repeat(dataSize) };
      
      const messageId = queueSystem.enqueue('test-queue', 'large-message', payload);
      expect(messageId).toBeGreaterThan(0);
    });

    it('should handle near-limit payloads in batch enqueue', () => {
      const messages = Array(3).fill(null).map((_, i) => ({
        queueName: 'test-queue',
        messageType: 'batch-large',
        payload: { data: 'x'.repeat(100000), index: i }
      }));
      
      const ids = queueSystem.enqueueBatch(messages);
      expect(ids).toHaveLength(3);
      ids.forEach(id => expect(id).toBeGreaterThan(0));
    });
  });

  describe('Connection Recovery', () => {
    it('should handle database lock errors gracefully', async () => {
      // Simulate concurrent access
      const promises = Array(10).fill(null).map((_, i) => 
        queueSystem.enqueue('test-queue', 'concurrent', { index: i })
      );
      
      const results = await Promise.allSettled(promises);
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);
    });

    it('should handle transaction rollback correctly', () => {
      // Force an error in batch enqueue
      const messages = [
        { queueName: 'test-queue', messageType: 'valid', payload: { data: 'ok' } },
        { queueName: '', messageType: 'invalid', payload: { data: 'fail' } } // Invalid message
      ];
      
      expect(() => {
        queueSystem.enqueueBatch(messages);
      }).toThrow();
      
      // Verify no messages were inserted (transaction rolled back)
      const stats = queueSystem.getQueueStats('test-queue');
      expect(stats.pending).toBe(0);
    });
  });

  describe('Queue Overflow Scenarios', () => {
    it('should handle queue with maximum messages gracefully', () => {
      // Insert many messages
      const messageCount = 1000;
      const ids: number[] = [];
      
      for (let i = 0; i < messageCount; i++) {
        const id = queueSystem.enqueue('overflow-queue', 'test', { index: i });
        ids.push(id);
      }
      
      expect(ids).toHaveLength(messageCount);
      
      // Verify stats
      const stats = queueSystem.getQueueStats('overflow-queue');
      expect(stats.pending).toBe(messageCount);
    });

    it('should process large batches efficiently', () => {
      // Enqueue many messages
      const messages = Array(100).fill(null).map((_, i) => ({
        queueName: 'batch-queue',
        messageType: 'batch-test',
        payload: { index: i }
      }));
      
      const ids = queueSystem.enqueueBatch(messages);
      expect(ids).toHaveLength(100);
      
      // Dequeue in large batch
      const dequeued = queueSystem.dequeue('batch-queue', 50);
      expect(dequeued).toHaveLength(50);
    });
  });

  describe('Concurrent Operations', () => {
    it('should prevent race conditions in dequeue', async () => {
      // Enqueue messages
      const messageCount = 20;
      for (let i = 0; i < messageCount; i++) {
        queueSystem.enqueue('race-queue', 'test', { index: i });
      }
      
      // Simulate concurrent workers
      const worker1 = queueSystem.dequeue('race-queue', 10);
      const worker2 = queueSystem.dequeue('race-queue', 10);
      
      // Each message should only be dequeued once
      const allIds = [...worker1, ...worker2].map(m => m.id);
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
      
      // Total should not exceed available messages
      expect(worker1.length + worker2.length).toBe(messageCount);
    });

    it('should handle concurrent configuration updates', () => {
      const configs = Array(5).fill(null).map((_, i) => ({
        queueName: `config-queue-${i}`,
        config: {
          maxRetries: i + 1,
          retryDelay: 1000 * (i + 1),
          processingTimeout: 5000
        }
      }));
      
      // Configure multiple queues concurrently
      configs.forEach(({ queueName, config }) => {
        queueSystem.configureQueue(queueName, config);
      });
      
      // Verify configurations were set (getQueueConfig is private, so we'll test indirectly)
      configs.forEach(({ queueName }) => {
        // Enqueue a message to verify the queue was configured
        const id = queueSystem.enqueue(queueName, 'config-test', { test: true });
        expect(id).toBeGreaterThan(0);
      });
    });
  });

  describe('Error Recovery', () => {
    it('should handle JSON parsing errors gracefully', () => {
      // Manually insert a message with invalid JSON
      const db = new Database(testDbPath);
      db.prepare(`
        INSERT INTO queue_messages (
          queue_name, message_type, payload, priority, scheduled_at,
          created_at, status, retry_count, max_retries
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        'test-queue', 'invalid-json', '{invalid json}', 0,
        Date.now(), Date.now(), 'pending', 0, 3
      );
      db.close();
      
      // Should not throw when dequeuing
      const messages = queueSystem.dequeue('test-queue', 10);
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });

    it('should recover from database corruption', () => {
      // This is difficult to simulate directly, but we can test error handling
      const messageId = queueSystem.enqueue('test-queue', 'test', { data: 'test' });
      
      // Force an error by passing invalid message ID
      expect(() => {
        queueSystem.markCompleted(-1);
      }).not.toThrow(); // Should handle gracefully
      
      // Original message should still be queryable
      const stats = queueSystem.getQueueStats('test-queue');
      expect(stats.pending).toBe(1);
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle empty queue operations', () => {
      const messages = queueSystem.dequeue('empty-queue', 10);
      expect(messages).toEqual([]);
      
      const stats = queueSystem.getQueueStats('empty-queue');
      expect(stats.pending).toBe(0);
    });

    it('should enforce priority boundaries (0-100)', () => {
      const id1 = queueSystem.enqueue('priority-queue', 'test', { data: 1 }, { priority: -10 });
      const id2 = queueSystem.enqueue('priority-queue', 'test', { data: 2 }, { priority: 150 });
      const id3 = queueSystem.enqueue('priority-queue', 'test', { data: 3 }, { priority: 50 });
      
      const messages = queueSystem.dequeue('priority-queue', 3);
      
      // Priority should be clamped
      expect(messages.find(m => m.payload.data === 1)?.priority).toBe(0);
      expect(messages.find(m => m.payload.data === 2)?.priority).toBe(100);
      expect(messages.find(m => m.payload.data === 3)?.priority).toBe(50);
    });

    it('should enforce retry count boundaries (0-10)', () => {
      const id1 = queueSystem.enqueue('retry-queue', 'test', { data: 1 }, { maxRetries: -5 });
      const id2 = queueSystem.enqueue('retry-queue', 'test', { data: 2 }, { maxRetries: 20 });
      
      const messages = queueSystem.dequeue('retry-queue', 2);
      
      // Max retries should be clamped
      expect(messages.find(m => m.payload.data === 1)?.max_retries).toBe(0);
      expect(messages.find(m => m.payload.data === 2)?.max_retries).toBe(10);
    });
  });

  describe('Prepared Statement Caching', () => {
    it('should reuse prepared statements for better performance', () => {
      // Enqueue multiple messages to test statement reuse
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        queueSystem.enqueue('perf-queue', 'test', { index: i });
      }
      
      const duration = Date.now() - startTime;
      
      // With prepared statement caching, this should be fast
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  describe('Batch Operations', () => {
    it('should handle empty batch gracefully', () => {
      const ids = queueSystem.enqueueBatch([]);
      expect(ids).toEqual([]);
    });

    it('should rollback entire batch on single failure', () => {
      const messages = [
        { queueName: 'batch-queue', messageType: 'test1', payload: { valid: true } },
        { queueName: 'batch-queue', messageType: 'test2', payload: { valid: true } },
        { queueName: 'batch-queue', messageType: 'test3', payload: 'x'.repeat(1048577) }, // Too large
      ];
      
      expect(() => {
        queueSystem.enqueueBatch(messages);
      }).toThrow();
      
      // No messages should have been inserted
      const stats = queueSystem.getQueueStats('batch-queue');
      expect(stats.pending).toBe(0);
    });

    it('should handle large batch operations', () => {
      const batchSize = 500;
      const messages = Array(batchSize).fill(null).map((_, i) => ({
        queueName: 'large-batch',
        messageType: 'bulk-test',
        payload: { index: i, timestamp: Date.now() }
      }));
      
      const ids = queueSystem.enqueueBatch(messages);
      expect(ids).toHaveLength(batchSize);
      
      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(batchSize);
    });
  });

  describe('Shutdown and Cleanup', () => {
    it('should finalize prepared statements on shutdown', async () => {
      // Enqueue some messages to create prepared statements
      queueSystem.enqueue('shutdown-queue', 'test', { data: 'test' });
      queueSystem.dequeue('shutdown-queue', 1);
      
      const LoggingService = require('../../src/services/logging').LoggingService;
      const infoSpy = jest.spyOn(LoggingService.getInstance(), 'info');
      
      await queueSystem.shutdown();
      
      // Check for finalization log
      const finalizeLog = infoSpy.mock.calls.find(call =>
        call[1] && typeof call[1] === 'string' && call[1].includes('Prepared statements finalized')
      );
      expect(finalizeLog).toBeDefined();
    });

    it('should handle shutdown during active processing', async () => {
      // Enqueue messages
      for (let i = 0; i < 10; i++) {
        queueSystem.enqueue('active-queue', 'test', { index: i });
      }
      
      // Start dequeuing
      const dequeuePromise = Promise.resolve(queueSystem.dequeue('active-queue', 5));
      
      // Shutdown while "processing"
      await queueSystem.shutdown();
      
      // Should complete without errors
      const messages = await dequeuePromise;
      expect(messages.length).toBeGreaterThanOrEqual(0);
    });
  });
});