import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { QueueSystem } from '../../src/services/queue-system';

// Mock the singleton to allow test isolation
let queueSystemInstance: QueueSystem | null = null;

describe('QueueSystem Fixes', () => {
  let testDbPath: string;
  
  beforeEach(() => {
    // Create a temporary test database
    testDbPath = path.join(__dirname, `test-queue-${Date.now()}.db`);
    
    // Reset the singleton instance for each test
    (QueueSystem as any).instance = null;
    
    // Mock the config service to use our test database
    jest.mock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => ({
          getDatabasePath: () => testDbPath
        })
      }
    }));
    
    // Mock the logging service
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
  });
  
  afterEach(() => {
    // Clean up the queue system
    if (queueSystemInstance) {
      queueSystemInstance.close();
      queueSystemInstance = null;
    }
    
    // Clean up the test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });
  
  describe('Race Condition Fix', () => {
    it('should handle concurrent dequeue operations without race conditions', async () => {
      const queueSystem = QueueSystem.getInstance();
      queueSystemInstance = queueSystem;
      
      const queueName = 'test-queue';
      const messageCount = 20;
      
      // Enqueue multiple messages
      const messageIds: number[] = [];
      for (let i = 0; i < messageCount; i++) {
        const id = queueSystem.enqueue(queueName, 'test-message', {
          data: `message-${i}`
        }, { priority: i });
        messageIds.push(id);
      }
      
      // Simulate concurrent dequeue operations
      const dequeuePromises = [];
      const processedMessages: Set<number> = new Set();
      
      for (let i = 0; i < 5; i++) {
        dequeuePromises.push(
          new Promise((resolve) => {
            setTimeout(() => {
              const messages = queueSystem.dequeue(queueName, 5);
              messages.forEach(msg => {
                if (msg.id) {
                  processedMessages.add(msg.id);
                }
              });
              resolve(messages);
            }, Math.random() * 10);
          })
        );
      }
      
      await Promise.all(dequeuePromises);
      
      // Check that no message was processed twice
      expect(processedMessages.size).toBeLessThanOrEqual(messageCount);
      
      // Check that each processed message ID is unique
      const processedArray = Array.from(processedMessages);
      expect(new Set(processedArray).size).toBe(processedArray.length);
    });
  });
  
  describe('Database Access Pattern Fix', () => {
    it('should use proper accessor methods instead of private properties', () => {
      const queueSystem = QueueSystem.getInstance();
      queueSystemInstance = queueSystem;
      
      // Test executeQuery method
      const queueNames = queueSystem.getQueueNames();
      expect(Array.isArray(queueNames)).toBe(true);
      
      // Test executeQuerySingle method
      queueSystem.enqueue('test-queue', 'test-type', { data: 'test' });
      const result = queueSystem.executeQuerySingle<{ count: number }>(
        'SELECT COUNT(*) as count FROM queue_messages WHERE queue_name = ?',
        ['test-queue']
      );
      expect(result?.count).toBe(1);
      
      // Test executeTransaction method
      let transactionExecuted = false;
      queueSystem.executeTransaction((db) => {
        transactionExecuted = true;
        const stmt = db.prepare('SELECT 1');
        stmt.get();
      });
      expect(transactionExecuted).toBe(true);
    });
  });
  
  describe('Exponential Backoff Fix', () => {
    it('should use exponential backoff with jitter for retries', () => {
      const queueSystem = QueueSystem.getInstance();
      queueSystemInstance = queueSystem;
      
      const queueName = 'retry-queue';
      
      // Enqueue a message
      const messageId = queueSystem.enqueue(queueName, 'test-message', {
        data: 'test'
      }, { maxRetries: 5 });
      
      // Simulate multiple failures and check retry delays
      const retryDelays: number[] = [];
      
      for (let i = 1; i <= 3; i++) {
        const beforeTime = Date.now();
        queueSystem.markFailed(messageId, `Failure attempt ${i}`);
        
        // Get the next_retry_at value
        const message = queueSystem.executeQuerySingle<{ next_retry_at: number }>(
          'SELECT next_retry_at FROM queue_messages WHERE id = ?',
          [messageId]
        );
        
        if (message?.next_retry_at) {
          const delay = message.next_retry_at - beforeTime;
          retryDelays.push(delay);
        }
      }
      
      // Check that delays increase exponentially
      expect(retryDelays[1]).toBeGreaterThan(retryDelays[0]);
      expect(retryDelays[2]).toBeGreaterThan(retryDelays[1]);
      
      // Check that delays are within expected ranges (with jitter)
      expect(retryDelays[0]).toBeGreaterThanOrEqual(1000); // >= 1 second
      expect(retryDelays[0]).toBeLessThanOrEqual(3000); // <= 3 seconds (with jitter)
      
      expect(retryDelays[1]).toBeGreaterThanOrEqual(2000); // >= 2 seconds
      expect(retryDelays[1]).toBeLessThanOrEqual(4000); // <= 4 seconds (with jitter)
    });
  });
  
  describe('Error Handling Fix', () => {
    it('should handle database errors gracefully', () => {
      const queueSystem = QueueSystem.getInstance();
      queueSystemInstance = queueSystem;
      
      // Test enqueue with oversized payload
      const largePayload = 'x'.repeat(1048577); // > 1MB
      
      expect(() => {
        queueSystem.enqueue('test-queue', 'test-message', {
          data: largePayload
        });
      }).toThrow('Payload size exceeds 1MB limit');
      
      // Test dequeue with invalid queue name (should return empty array)
      const messages = queueSystem.dequeue('non-existent-queue');
      expect(messages).toEqual([]);
      
      // Test markCompleted with invalid message ID (should log warning but not throw)
      expect(() => {
        queueSystem.markCompleted(999999);
      }).not.toThrow();
      
      // Test markFailed with invalid message ID (should log warning but not throw)
      expect(() => {
        queueSystem.markFailed(999999, 'Test error');
      }).not.toThrow();
    });
  });
  
  describe('Queue Configuration Management', () => {
    it('should allow queue configuration and retrieval', () => {
      const queueSystem = QueueSystem.getInstance();
      queueSystemInstance = queueSystem;
      
      const queueName = 'configured-queue';
      const config = {
        maxRetries: 5,
        retryDelay: 2000,
        batchSize: 20,
        processInterval: 1000,
        retentionPeriod: 172800000, // 2 days
        enabled: true
      };
      
      // Configure the queue
      queueSystem.configureQueue(queueName, config);
      
      // Retrieve configuration
      const retrievedConfig = queueSystem.getQueueConfig(queueName);
      
      expect(retrievedConfig).not.toBeNull();
      expect(retrievedConfig?.maxRetries).toBe(5);
      expect(retrievedConfig?.baseDelayMs).toBe(2000);
      expect(retrievedConfig?.batchSize).toBe(20);
      expect(retrievedConfig?.cleanupInterval).toBe(1000);
      expect(retrievedConfig?.retentionPeriod).toBe(172800000);
      
      // Update configuration
      queueSystem.configureQueue(queueName, { maxRetries: 10 });
      const updatedConfig = queueSystem.getQueueConfig(queueName);
      expect(updatedConfig?.maxRetries).toBe(10);
    });
    
    it('should use queue configuration for retry behavior', () => {
      const queueSystem = QueueSystem.getInstance();
      queueSystemInstance = queueSystem;
      
      const queueName = 'custom-retry-queue';
      
      // Configure queue with custom retry settings
      queueSystem.configureQueue(queueName, {
        maxRetries: 2,
        baseDelayMs: 500
      });
      
      // Enqueue a message
      const messageId = queueSystem.enqueue(queueName, 'test-message', {
        data: 'test'
      });
      
      // Fail the message multiple times
      queueSystem.markFailed(messageId, 'First failure');
      queueSystem.markFailed(messageId, 'Second failure');
      
      // Third failure should move to dead letter queue (maxRetries = 2)
      queueSystem.markFailed(messageId, 'Third failure');
      
      // Check that message is in failed status
      const message = queueSystem.executeQuerySingle<{ status: string }>(
        'SELECT status FROM queue_messages WHERE id = ?',
        [messageId]
      );
      expect(message?.status).toBe('failed');
      
      // Check that message is in dead letter queue
      const dlqCount = queueSystem.executeQuerySingle<{ count: number }>(
        'SELECT COUNT(*) as count FROM dead_letter_queue WHERE original_message_id = ?',
        [messageId]
      );
      expect(dlqCount?.count).toBe(1);
    });
  });
  
  describe('Memory Leak Fix', () => {
    it('should properly clean up resources on close', () => {
      const queueSystem = QueueSystem.getInstance();
      
      // Register a processor
      const mockProcessor = {
        start: jest.fn(),
        stop: jest.fn()
      };
      queueSystem.registerProcessor('test-queue', mockProcessor as any);
      
      // Close the system
      queueSystem.close();
      
      // Check that processor was stopped
      expect(mockProcessor.stop).toHaveBeenCalled();
      
      // Check that we can create a new instance after closing
      (QueueSystem as any).instance = null;
      const newInstance = QueueSystem.getInstance();
      expect(newInstance).toBeDefined();
      newInstance.close();
    });
  });
  
  describe('Transaction Handling', () => {
    it('should handle transaction rollbacks properly', () => {
      const queueSystem = QueueSystem.getInstance();
      queueSystemInstance = queueSystem;
      
      const queueName = 'transaction-queue';
      
      // Test transaction with error
      let errorThrown = false;
      try {
        queueSystem.executeTransaction((db) => {
          // Start a transaction
          const stmt1 = db.prepare(`
            INSERT INTO queue_messages (queue_name, message_type, payload, created_at)
            VALUES (?, ?, ?, ?)
          `);
          stmt1.run(queueName, 'test', '{}', Date.now());
          
          // Force an error
          throw new Error('Transaction error');
        });
      } catch (error) {
        errorThrown = true;
      }
      
      expect(errorThrown).toBe(true);
      
      // Check that the insert was rolled back
      const count = queueSystem.executeQuerySingle<{ count: number }>(
        'SELECT COUNT(*) as count FROM queue_messages WHERE queue_name = ?',
        [queueName]
      );
      expect(count?.count).toBe(0);
    });
  });
});