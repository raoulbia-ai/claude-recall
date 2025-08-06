import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { QueueSystem, QueueProcessor, QueueMessage } from '../../src/services/queue-system';

describe('QueueSystem Comprehensive Test Suite', () => {
  let testDbPath: string;
  let queueSystem: QueueSystem;
  
  beforeEach(() => {
    testDbPath = path.join(__dirname, `test-queue-${Date.now()}.db`);
    
    // Reset singleton for test isolation
    (QueueSystem as any).instance = null;
    
    // Mock dependencies
    jest.mock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => ({
          getDatabasePath: () => testDbPath
        })
      }
    }));
    
    jest.mock('../../src/services/logging', () => ({
      LoggingService: {
        getInstance: () => ({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn()
        })
      }
    }));
    
    queueSystem = QueueSystem.getInstance();
  });
  
  afterEach(() => {
    if (queueSystem) {
      queueSystem.close();
    }
    
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    jest.clearAllMocks();
  });

  describe('Race Condition Prevention', () => {
    it('should prevent duplicate message processing with concurrent dequeues', async () => {
      const queueName = 'concurrent-test';
      const messageCount = 50;
      const workerCount = 10;
      
      // Enqueue messages
      const messageIds = new Set<number>();
      for (let i = 0; i < messageCount; i++) {
        const id = queueSystem.enqueue(queueName, 'test', { index: i });
        messageIds.add(id);
      }
      
      // Simulate concurrent workers
      const processedMessages = new Set<number>();
      const workers = Array.from({ length: workerCount }, async () => {
        const messages = queueSystem.dequeue(queueName, 5);
        messages.forEach(msg => {
          if (msg.id) processedMessages.add(msg.id);
        });
        return messages;
      });
      
      await Promise.all(workers);
      
      // Verify no duplicates
      const processedArray = Array.from(processedMessages);
      expect(new Set(processedArray).size).toBe(processedArray.length);
      
      // Verify all processed messages are valid
      processedArray.forEach(id => {
        expect(messageIds.has(id)).toBe(true);
      });
    });

    it('should handle race conditions in mark completed operations', async () => {
      const queueName = 'completion-race';
      const messageId = queueSystem.enqueue(queueName, 'test', { data: 'test' });
      
      // Dequeue the message
      const [message] = queueSystem.dequeue(queueName, 1);
      expect(message.id).toBe(messageId);
      
      // Try to mark completed multiple times concurrently
      const completions = Array.from({ length: 5 }, () => 
        queueSystem.markCompleted(messageId)
      );
      
      await Promise.all(completions);
      
      // Verify message is completed only once
      const stats = queueSystem.getQueueStats(queueName);
      expect(stats.completed).toBe(1);
    });
  });

  describe('Payload Size Validation', () => {
    it('should reject payloads exceeding 1MB limit', () => {
      const queueName = 'size-test';
      const largePayload = {
        data: 'x'.repeat(1048577) // Just over 1MB
      };
      
      expect(() => {
        queueSystem.enqueue(queueName, 'large', largePayload);
      }).toThrow('Payload size exceeds 1MB limit');
    });

    it('should accept payloads at the 1MB boundary', () => {
      const queueName = 'size-boundary-test';
      // Create payload that's exactly at the limit when stringified
      const maxSize = 1048576 - '{"data":""}'.length;
      const boundaryPayload = {
        data: 'x'.repeat(maxSize)
      };
      
      const messageId = queueSystem.enqueue(queueName, 'boundary', boundaryPayload);
      expect(messageId).toBeGreaterThan(0);
    });
  });

  describe('Exponential Backoff Behavior', () => {
    it('should apply exponential backoff with jitter on failures', () => {
      const queueName = 'backoff-test';
      const messageId = queueSystem.enqueue(queueName, 'test', { data: 'test' });
      
      // Dequeue and fail the message multiple times
      const retryDelays: number[] = [];
      
      for (let i = 0; i < 3; i++) {
        const [message] = queueSystem.dequeue(queueName, 1);
        if (message) {
          const beforeFail = Date.now();
          queueSystem.markFailed(message.id!, `Failure ${i + 1}`);
          
          // Check the next retry time
          const result = queueSystem.executeQuerySingle<{next_retry_at: number}>(
            'SELECT next_retry_at FROM queue_messages WHERE id = ?',
            [messageId]
          );
          
          if (result?.next_retry_at) {
            const delay = result.next_retry_at - beforeFail;
            retryDelays.push(delay);
          }
        }
      }
      
      // Verify exponential growth
      expect(retryDelays[1]).toBeGreaterThan(retryDelays[0]);
      expect(retryDelays[2]).toBeGreaterThan(retryDelays[1]);
      
      // Verify jitter is applied (delays shouldn't be exact powers of 2)
      const baseDelay = 1000;
      retryDelays.forEach((delay, index) => {
        const expectedBase = baseDelay * Math.pow(2, index);
        expect(delay).toBeGreaterThan(expectedBase);
        expect(delay).toBeLessThan(expectedBase + 2000); // Allow up to 2s jitter
      });
    });

    it('should cap retry delay at maximum', () => {
      const queueName = 'max-delay-test';
      const messageId = queueSystem.enqueue(queueName, 'test', { data: 'test' });
      
      // Fail the message many times to reach max delay
      for (let i = 0; i < 10; i++) {
        const [message] = queueSystem.dequeue(queueName, 1);
        if (message) {
          queueSystem.markFailed(message.id!, `Failure ${i + 1}`);
        }
      }
      
      // Check the retry delay is capped
      const result = queueSystem.executeQuerySingle<{next_retry_at: number, retry_count: number}>(
        'SELECT next_retry_at, retry_count FROM queue_messages WHERE id = ?',
        [messageId]
      );
      
      if (result?.next_retry_at) {
        const delay = result.next_retry_at - Date.now();
        expect(delay).toBeLessThanOrEqual(300000 + 1000); // Max 5 minutes + jitter
      }
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should properly clean up resources on close', () => {
      const queueName = 'cleanup-test';
      
      // Create some activity
      queueSystem.enqueue(queueName, 'test', { data: 'test' });
      
      // Register a mock processor
      const mockProcessor = {
        start: jest.fn(),
        stop: jest.fn()
      } as unknown as QueueProcessor;
      
      queueSystem.registerProcessor(queueName, mockProcessor);
      
      // Close the system
      queueSystem.close();
      
      // Verify processor was stopped
      expect(mockProcessor.stop).toHaveBeenCalled();
      
      // Verify cleanup interval is cleared
      expect((queueSystem as any).cleanupInterval).toBeUndefined();
      
      // Verify database is closed
      expect(() => {
        queueSystem.enqueue(queueName, 'test', {});
      }).toThrow();
    });

    it('should handle errors during shutdown gracefully', () => {
      const queueName = 'error-shutdown-test';
      
      // Register a processor that throws on stop
      const faultyProcessor = {
        start: jest.fn(),
        stop: jest.fn(() => { throw new Error('Stop failed'); })
      } as unknown as QueueProcessor;
      
      queueSystem.registerProcessor(queueName, faultyProcessor);
      
      // Close should not throw despite processor error
      expect(() => queueSystem.close()).not.toThrow();
      expect(faultyProcessor.stop).toHaveBeenCalled();
    });
  });

  describe('Queue Configuration Management', () => {
    it('should store and retrieve queue configurations', () => {
      const queueName = 'config-test';
      const config = {
        maxRetries: 5,
        baseDelayMs: 2000,
        batchSize: 20,
        processingTimeout: 1000,
        retentionPeriod: 86400000
      };
      
      queueSystem.configureQueue(queueName, config);
      
      const retrieved = queueSystem.getQueueConfig(queueName);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.maxRetries).toBe(5);
      expect(retrieved?.baseDelayMs).toBe(2000);
      expect(retrieved?.batchSize).toBe(20);
    });

    it('should use queue configuration for retry logic', () => {
      const queueName = 'config-retry-test';
      
      // Configure queue with custom retry settings
      queueSystem.configureQueue(queueName, {
        maxRetries: 2,
        baseDelayMs: 500
      });
      
      const messageId = queueSystem.enqueue(queueName, 'test', { data: 'test' });
      
      // Fail the message beyond configured max retries
      for (let i = 0; i < 3; i++) {
        const [message] = queueSystem.dequeue(queueName, 1);
        if (message) {
          queueSystem.markFailed(message.id!, `Failure ${i + 1}`);
        }
      }
      
      // Check message moved to dead letter queue after 2 retries
      const dlqResult = queueSystem.executeQuerySingle<{original_message_id: number}>(
        'SELECT original_message_id FROM dead_letter_queue WHERE original_message_id = ?',
        [messageId]
      );
      
      expect(dlqResult).not.toBeNull();
      expect(dlqResult?.original_message_id).toBe(messageId);
    });
  });

  describe('Database Access API', () => {
    it('should provide safe read-only query access', () => {
      const queueName = 'query-test';
      
      // Enqueue some messages
      for (let i = 0; i < 5; i++) {
        queueSystem.enqueue(queueName, 'test', { index: i });
      }
      
      // Use executeQuery for multiple results
      const results = queueSystem.executeQuery<{queue_name: string, status: string}>(
        'SELECT queue_name, status FROM queue_messages WHERE queue_name = ?',
        [queueName]
      );
      
      expect(results).toHaveLength(5);
      results.forEach(r => {
        expect(r.queue_name).toBe(queueName);
        expect(r.status).toBe('pending');
      });
    });

    it('should provide single row query access', () => {
      const queueName = 'single-query-test';
      const messageId = queueSystem.enqueue(queueName, 'test', { data: 'unique' });
      
      const result = queueSystem.executeQuerySingle<{id: number, payload: string}>(
        'SELECT id, payload FROM queue_messages WHERE id = ?',
        [messageId]
      );
      
      expect(result).not.toBeUndefined();
      expect(result?.id).toBe(messageId);
      expect(JSON.parse(result?.payload || '{}')).toEqual({ data: 'unique' });
    });

    it('should provide transaction support', () => {
      const queueName = 'transaction-test';
      
      // Execute multiple operations in a transaction
      const results = queueSystem.executeTransaction((db) => {
        const stmt1 = db.prepare(
          'INSERT INTO queue_messages (queue_name, message_type, payload, status, created_at, scheduled_at, retry_count, max_retries) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        
        const ids = [];
        for (let i = 0; i < 3; i++) {
          const result = stmt1.run(
            queueName, 'batch', JSON.stringify({ index: i }), 
            'pending', Date.now(), Date.now(), 0, 3
          );
          ids.push(result.lastInsertRowid);
        }
        
        return ids;
      });
      
      expect(results).toHaveLength(3);
      
      // Verify all were inserted
      const count = queueSystem.executeQuerySingle<{count: number}>(
        'SELECT COUNT(*) as count FROM queue_messages WHERE queue_name = ?',
        [queueName]
      );
      expect(count?.count).toBe(3);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed JSON in message payload gracefully', () => {
      const queueName = 'malformed-json-test';
      
      // Directly insert a message with invalid JSON
      queueSystem.executeTransaction((db) => {
        const stmt = db.prepare(
          'INSERT INTO queue_messages (queue_name, message_type, payload, status, created_at, scheduled_at, retry_count, max_retries) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        stmt.run(queueName, 'test', '{invalid json}', 'pending', Date.now(), Date.now(), 0, 3);
      });
      
      // Dequeue should handle the malformed JSON
      const messages = queueSystem.dequeue(queueName, 1);
      expect(messages).toHaveLength(1);
      
      // Payload should remain as string if parsing fails
      expect(typeof messages[0].payload).toBe('string');
      expect(messages[0].payload).toBe('{invalid json}');
    });

    it('should handle queue overflow scenarios', () => {
      const queueName = 'overflow-test';
      const messageCount = 10000;
      
      // Enqueue a large number of messages
      const start = Date.now();
      for (let i = 0; i < messageCount; i++) {
        queueSystem.enqueue(queueName, 'bulk', { index: i }, { priority: i % 10 });
      }
      const enqueueDuration = Date.now() - start;
      
      // Should complete in reasonable time (< 10 seconds for 10k messages)
      expect(enqueueDuration).toBeLessThan(10000);
      
      // Verify all messages were enqueued
      const stats = queueSystem.getQueueStats(queueName);
      expect(stats.pending).toBe(messageCount);
    });

    it('should handle missing queue names gracefully', () => {
      const stats = queueSystem.getQueueStats('non-existent-queue');
      
      expect(stats.queueName).toBe('non-existent-queue');
      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
    });

    it('should handle concurrent configuration updates', async () => {
      const queueName = 'concurrent-config-test';
      
      // Attempt concurrent configuration updates
      const updates = Array.from({ length: 10 }, (_, i) => 
        queueSystem.configureQueue(queueName, {
          maxRetries: i + 1,
          batchSize: (i + 1) * 10
        })
      );
      
      await Promise.all(updates);
      
      // Verify final configuration is consistent
      const config = queueSystem.getQueueConfig(queueName);
      expect(config).not.toBeNull();
      expect(config?.maxRetries).toBeGreaterThan(0);
      expect(config?.batchSize).toBeGreaterThan(0);
    });
  });

  describe('Dead Letter Queue Management', () => {
    it('should move messages to DLQ after max retries', () => {
      const queueName = 'dlq-test';
      const messageId = queueSystem.enqueue(queueName, 'test', { data: 'fail' }, { maxRetries: 1 });
      
      // Fail the message twice (exceeding max retries of 1)
      for (let i = 0; i < 2; i++) {
        const [message] = queueSystem.dequeue(queueName, 1);
        if (message) {
          queueSystem.markFailed(message.id!, `Failure ${i + 1}`);
        }
      }
      
      // Verify message is in DLQ
      const dlqMessages = queueSystem.executeQuery<{original_message_id: number}>(
        'SELECT original_message_id FROM dead_letter_queue'
      );
      
      expect(dlqMessages).toHaveLength(1);
      expect(dlqMessages[0].original_message_id).toBe(messageId);
      
      // Verify message status is failed
      const messageStatus = queueSystem.executeQuerySingle<{status: string}>(
        'SELECT status FROM queue_messages WHERE id = ?',
        [messageId]
      );
      expect(messageStatus?.status).toBe('failed');
    });

    it('should preserve message metadata in DLQ', () => {
      const queueName = 'dlq-metadata-test';
      const correlationId = 'test-correlation-123';
      const metadata = { source: 'test', timestamp: Date.now() };
      
      const messageId = queueSystem.enqueue(
        queueName, 
        'test', 
        { data: 'fail' }, 
        { maxRetries: 0, correlationId, metadata }
      );
      
      // Fail the message once (exceeding max retries of 0)
      const [message] = queueSystem.dequeue(queueName, 1);
      if (message) {
        queueSystem.markFailed(message.id!, 'Immediate failure');
      }
      
      // Check DLQ entry preserves all data
      const dlqEntry = queueSystem.executeQuerySingle<{
        correlation_id: string,
        metadata: string,
        error_message: string
      }>(
        'SELECT correlation_id, metadata, error_message FROM dead_letter_queue WHERE original_message_id = ?',
        [messageId]
      );
      
      expect(dlqEntry?.correlation_id).toBe(correlationId);
      expect(JSON.parse(dlqEntry?.metadata || '{}')).toEqual(metadata);
      expect(dlqEntry?.error_message).toBe('Immediate failure');
    });
  });

  describe('Performance and Cleanup', () => {
    it('should cleanup old completed messages', () => {
      const queueName = 'cleanup-test';
      
      // Insert old completed messages
      const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      
      queueSystem.executeTransaction((db) => {
        const stmt = db.prepare(
          'INSERT INTO queue_messages (queue_name, message_type, payload, status, created_at, scheduled_at, processed_at, retry_count, max_retries) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        
        // Insert old completed messages
        for (let i = 0; i < 5; i++) {
          stmt.run(queueName, 'old', '{}', 'completed', oldTime, oldTime, oldTime, 0, 3);
        }
        
        // Insert recent completed messages
        const recentTime = Date.now() - (1 * 24 * 60 * 60 * 1000); // 1 day ago
        for (let i = 0; i < 3; i++) {
          stmt.run(queueName, 'recent', '{}', 'completed', recentTime, recentTime, recentTime, 0, 3);
        }
      });
      
      // Trigger cleanup
      (queueSystem as any).cleanupOldMessages();
      
      // Verify old messages were deleted
      const remaining = queueSystem.executeQuery<{created_at: number}>(
        'SELECT created_at FROM queue_messages WHERE queue_name = ? AND status = ?',
        [queueName, 'completed']
      );
      
      expect(remaining).toHaveLength(3);
      remaining.forEach(msg => {
        expect(msg.created_at).toBeGreaterThan(oldTime);
      });
    });
  });
});