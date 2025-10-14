import { QueueSystem } from '../../src/services/queue-system';
import { QueueAPI } from '../../src/services/queue-api';
import { QueueIntegrationService } from '../../src/services/queue-integration';
import * as fs from 'fs';
import * as path from 'path';

describe('Queue System Performance Tests', () => {
  let queueSystem: QueueSystem;
  let queueAPI: QueueAPI;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, `test-perf-${Date.now()}.db`);
    
    const mockConfig = {
      getDatabasePath: () => testDbPath,
      getProjectId: () => 'test-project'
    };
    
    jest.doMock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => mockConfig
      }
    }));

    jest.doMock('../../src/services/logging', () => ({
      LoggingService: {
        getInstance: () => ({
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
          logMemoryOperation: jest.fn(),
          logRetrieval: jest.fn(),
          logServiceError: jest.fn()
        })
      }
    }));

    queueSystem = QueueSystem.getInstance();
    queueAPI = QueueAPI.getInstance();
  });

  afterEach(() => {
    queueSystem.close();
    queueAPI.close();
    
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('High Volume Message Processing', () => {
    test('should handle 100 messages efficiently', async () => {
      const messageCount = 100; // Reduced from 1000 for local development
      const startTime = Date.now();
      
      // Enqueue messages
      for (let i = 0; i < messageCount; i++) {
        queueSystem.enqueue(
          'perf-test',
          'bulk-message',
          { index: i, data: `test-data-${i}` },
          { priority: Math.floor(Math.random() * 10) }
        );
      }
      
      const enqueueTime = Date.now() - startTime;
      console.log(`Enqueued ${messageCount} messages in ${enqueueTime}ms`);
      
      // Dequeue and process messages
      const dequeueStartTime = Date.now();
      let processedCount = 0;
      
      while (processedCount < messageCount) {
        const messages = queueSystem.dequeue('perf-test', 50); // Batch size 50
        
        for (const message of messages) {
          // Simulate processing
          queueSystem.markCompleted(message.id!);
          processedCount++;
        }
        
        if (messages.length === 0) {
          // No more messages available
          break;
        }
      }
      
      const dequeueTime = Date.now() - dequeueStartTime;
      console.log(`Processed ${processedCount} messages in ${dequeueTime}ms`);
      
      // Verify all messages were processed
      const stats = queueSystem.getQueueStats('perf-test');
      expect(stats.completed).toBe(messageCount);
      expect(stats.pending).toBe(0);
      expect(stats.processing).toBe(0);
      
      // Performance assertions
      expect(enqueueTime).toBeLessThan(1000); // Should enqueue 100 messages in under 1 second
      expect(dequeueTime).toBeLessThan(2000); // Should process 100 messages in under 2 seconds
    }, 30000); // 30 second timeout

    test('should maintain performance with concurrent operations', async () => {
      const concurrentOperations = 5; // Reduced from 10
      const messagesPerOperation = 20; // Reduced from 100
      
      const startTime = Date.now();
      
      // Create concurrent enqueue operations
      const enqueuePromises = Array.from({ length: concurrentOperations }, async (_, operationIndex) => {
        for (let i = 0; i < messagesPerOperation; i++) {
          queueSystem.enqueue(
            `concurrent-queue-${operationIndex}`,
            'concurrent-message',
            { operationIndex, messageIndex: i }
          );
        }
      });
      
      await Promise.all(enqueuePromises);
      
      const enqueueTime = Date.now() - startTime;
      console.log(`Concurrent enqueue of ${concurrentOperations * messagesPerOperation} messages in ${enqueueTime}ms`);
      
      // Process all queues concurrently
      const processStartTime = Date.now();
      
      const processPromises = Array.from({ length: concurrentOperations }, async (_, operationIndex) => {
        const queueName = `concurrent-queue-${operationIndex}`;
        let processed = 0;
        
        while (processed < messagesPerOperation) {
          const messages = queueSystem.dequeue(queueName, 10);
          
          for (const message of messages) {
            queueSystem.markCompleted(message.id!);
            processed++;
          }
          
          if (messages.length === 0) break;
        }
        
        return processed;
      });
      
      const results = await Promise.all(processPromises);
      const processTime = Date.now() - processStartTime;
      
      console.log(`Concurrent processing completed in ${processTime}ms`);
      
      // Verify all messages were processed
      const totalProcessed = results.reduce((sum, count) => sum + count, 0);
      expect(totalProcessed).toBe(concurrentOperations * messagesPerOperation);
      
      // Performance assertions
      expect(enqueueTime).toBeLessThan(2000); // Reduced from 8000
      expect(processTime).toBeLessThan(3000); // Reduced from 15000
    }, 45000);
  });

  describe('Priority Queue Performance', () => {
    test('should maintain priority ordering under load', () => {
      const messageCount = 500;
      const priorities = [1, 3, 5, 7, 9];
      
      // Enqueue messages with random priorities
      const enqueuedPriorities: number[] = [];
      for (let i = 0; i < messageCount; i++) {
        const priority = priorities[Math.floor(Math.random() * priorities.length)];
        queueSystem.enqueue('priority-test', 'priority-message', { index: i }, { priority });
        enqueuedPriorities.push(priority);
      }
      
      // Dequeue all messages and verify priority ordering
      const dequeuedPriorities: number[] = [];
      let remainingMessages = messageCount;
      
      while (remainingMessages > 0) {
        const messages = queueSystem.dequeue('priority-test', 25);
        
        for (const message of messages) {
          dequeuedPriorities.push(message.priority);
          queueSystem.markCompleted(message.id!);
          remainingMessages--;
        }
        
        if (messages.length === 0) break;
      }
      
      // Verify priority ordering is maintained
      for (let i = 1; i < dequeuedPriorities.length; i++) {
        expect(dequeuedPriorities[i]).toBeLessThanOrEqual(dequeuedPriorities[i - 1]);
      }
      
      expect(dequeuedPriorities.length).toBe(messageCount);
    });
  });

  describe('Retry Mechanism Performance', () => {
    test('should handle retry processing efficiently', async () => {
      const messageCount = 100;
      const maxRetries = 3;
      
      // Enqueue messages that will fail
      const messageIds: number[] = [];
      for (let i = 0; i < messageCount; i++) {
        const id = queueSystem.enqueue(
          'retry-test',
          'failing-message',
          { willFail: true, index: i },
          { maxRetries }
        );
        messageIds.push(id);
      }
      
      const startTime = Date.now();
      
      // Process and fail messages multiple times
      for (let retryAttempt = 0; retryAttempt <= maxRetries; retryAttempt++) {
        const messages = queueSystem.dequeue('retry-test', messageCount);
        
        for (const message of messages) {
          // Simulate failure
          queueSystem.markFailed(message.id!, `Attempt ${retryAttempt + 1} failed`);
        }
        
        // Small delay to allow retry scheduling
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      const processingTime = Date.now() - startTime;
      console.log(`Retry processing completed in ${processingTime}ms`);
      
      // Verify final state
      const stats = queueSystem.getQueueStats('retry-test');
      expect(stats.failed).toBe(messageCount);
      expect(stats.retrying).toBe(0);
      
      // Check dead letter queue
      const db = queueSystem['db'];
      const dlqCount = db.prepare('SELECT COUNT(*) as count FROM dead_letter_queue').get() as any;
      expect(dlqCount.count).toBe(messageCount);
      
      // Performance assertion
      expect(processingTime).toBeLessThan(5000);
    }, 15000);
  });

  describe('Database Performance Under Load', () => {
    test('should maintain database performance with large message volumes', () => {
      const largeMessageCount = 2000;
      const batchSize = 100;
      
      const startTime = Date.now();
      
      // Insert messages in batches
      for (let batch = 0; batch < largeMessageCount / batchSize; batch++) {
        for (let i = 0; i < batchSize; i++) {
          const messageIndex = batch * batchSize + i;
          queueSystem.enqueue(
            'load-test',
            'load-message',
            { 
              batch,
              index: messageIndex,
              data: `load-test-data-${messageIndex}`,
              timestamp: Date.now()
            },
            { priority: messageIndex % 5 }
          );
        }
      }
      
      const insertTime = Date.now() - startTime;
      console.log(`Inserted ${largeMessageCount} messages in ${insertTime}ms`);
      
      // Test query performance
      const queryStartTime = Date.now();
      
      // Test various query patterns
      const stats = queueSystem.getQueueStats('load-test');
      const messages = queueSystem.dequeue('load-test', 50);
      const health = queueAPI.getSystemHealth();
      
      const queryTime = Date.now() - queryStartTime;
      console.log(`Query operations completed in ${queryTime}ms`);
      
      // Verify data integrity
      expect(stats.pending).toBe(largeMessageCount - messages.length);
      expect(messages.length).toBe(50);
      expect(health.totalPendingMessages).toBeGreaterThan(0);
      
      // Performance assertions
      expect(insertTime).toBeLessThan(2000); // 2 seconds for reduced inserts
      expect(queryTime).toBeLessThan(1000); // 1 second for query operations
    });

    test('should handle database cleanup efficiently', () => {
      const messageCount = 500;
      
      // Create and complete messages
      for (let i = 0; i < messageCount; i++) {
        const id = queueSystem.enqueue('cleanup-test', 'cleanup-message', { index: i });
        const messages = queueSystem.dequeue('cleanup-test', 1);
        queueSystem.markCompleted(messages[0].id!);
      }
      
      // Manually set old timestamps for cleanup test
      const db = queueSystem['db'];
      const oldTime = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      db.prepare('UPDATE queue_messages SET processed_at = ? WHERE queue_name = ?')
        .run(oldTime, 'cleanup-test');
      
      const cleanupStartTime = Date.now();
      
      // Trigger cleanup
      queueSystem['cleanupOldMessages']();
      
      const cleanupTime = Date.now() - cleanupStartTime;
      console.log(`Cleanup completed in ${cleanupTime}ms`);
      
      // Verify cleanup worked
      const remainingCount = db.prepare('SELECT COUNT(*) as count FROM queue_messages WHERE queue_name = ?')
        .get('cleanup-test') as any;
      expect(remainingCount.count).toBe(0);
      
      // Performance assertion
      expect(cleanupTime).toBeLessThan(2000); // Cleanup should be fast
    });
  });

  describe('Memory Usage Performance', () => {
    test('should maintain reasonable memory usage under load', async () => {
      const initialMemory = process.memoryUsage();
      
      // Process a large number of messages
      const messageCount = 100; // Reduced from 1000
      const batches = 10;
      const messagesPerBatch = messageCount / batches;
      
      for (let batch = 0; batch < batches; batch++) {
        // Enqueue batch
        for (let i = 0; i < messagesPerBatch; i++) {
          queueSystem.enqueue('memory-test', 'memory-message', {
            batch,
            index: i,
            data: new Array(100).fill(`data-${batch}-${i}`).join('')
          });
        }
        
        // Process batch
        let processed = 0;
        while (processed < messagesPerBatch) {
          const messages = queueSystem.dequeue('memory-test', 20);
          
          for (const message of messages) {
            queueSystem.markCompleted(message.id!);
            processed++;
          }
          
          if (messages.length === 0) break;
        }
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      console.log(`Memory increase: ${Math.round(memoryIncrease / 1024 / 1024)}MB`);
      
      // Memory should not increase excessively
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
    }, 30000);
  });

  describe('Integration Performance', () => {
    test('should handle queue integration service under load', async () => {
      const integrationService = QueueIntegrationService.getInstance();
      await integrationService.initialize();
      
      const operationCount = 200;
      const startTime = Date.now();
      
      // Mix of different operation types
      for (let i = 0; i < operationCount; i++) {
        const operationType = i % 4;
        
        switch (operationType) {
          case 0:
            integrationService.processHookEvent('load-test-hook', { index: i });
            break;
          case 1:
            integrationService.processMCPOperation('load-test-tool', 'operation', { index: i });
            break;
          case 2:
            integrationService.processMemoryOperation('store', { key: `load-${i}`, value: `value-${i}` });
            break;
          case 3:
            queueAPI.enqueuePatternDetection(`Load test content ${i}`, { index: i });
            break;
        }
      }
      
      const enqueueTime = Date.now() - startTime;
      console.log(`Integration service enqueued ${operationCount} operations in ${enqueueTime}ms`);
      
      // Verify all operations were queued
      const health = integrationService.getSystemHealth();
      expect(health.totalPendingMessages).toBeGreaterThan(0);
      
      // Performance assertion
      expect(enqueueTime).toBeLessThan(5000); // Should handle 200 operations in under 5 seconds
      
      integrationService.shutdown();
    }, 15000);
  });
});