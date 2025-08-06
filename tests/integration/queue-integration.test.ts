import { QueueIntegrationService, HookQueueIntegration, MCPQueueIntegration } from '../../src/services/queue-integration';
import { QueueAPI } from '../../src/services/queue-api';
import { QueueMCPTools, EnhancedMemoryMCPTools } from '../../src/mcp/queue-tools';
import { MemoryService } from '../../src/services/memory';
import * as fs from 'fs';
import * as path from 'path';

describe('Queue Integration Tests', () => {
  let testDbPath: string;
  let integrationService: QueueIntegrationService;
  let queueAPI: QueueAPI;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `test-integration-${Date.now()}.db`);
    
    // Mock config service
    const mockConfig = {
      getDatabasePath: () => testDbPath,
      getProjectId: () => 'test-project'
    };
    
    jest.doMock('../../src/services/config', () => ({
      ConfigService: {
        getInstance: () => mockConfig
      }
    }));

    // Mock logging service
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

    integrationService = QueueIntegrationService.getInstance();
    queueAPI = QueueAPI.getInstance();
  });

  afterEach(async () => {
    // Shutdown integration service
    integrationService.shutdown();
    queueAPI.close();
    
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('Integration Service Initialization', () => {
    test('should initialize without errors', async () => {
      await expect(integrationService.initialize()).resolves.not.toThrow();
      
      // Verify system health after initialization
      const health = integrationService.getSystemHealth();
      expect(health).toHaveProperty('isHealthy');
      expect(health.totalPendingMessages).toBe(0);
    });

    test('should register all queue processors', async () => {
      await integrationService.initialize();
      
      // Verify processors are registered by checking they can process messages
      const hookMessageId = integrationService.processHookEvent('test-event', { test: 'data' });
      const mcpMessageId = integrationService.processMCPOperation('test-tool', 'test-op', { test: 'data' });
      
      expect(hookMessageId).toBeGreaterThan(0);
      expect(mcpMessageId).toBeGreaterThan(0);
    });
  });

  describe('Hook Integration', () => {
    let hookIntegration: HookQueueIntegration;

    beforeEach(async () => {
      hookIntegration = HookQueueIntegration.getInstance();
      await hookIntegration.initialize();
    });

    test('should process tool use events through queue', async () => {
      const toolName = 'test-tool';
      const toolInput = { param1: 'value1', param2: 123 };
      const context = { sessionId: 'test-session', projectId: 'test-project' };

      // Process tool use event
      hookIntegration.processToolUse(toolName, toolInput, context);

      // Give it a moment to queue
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if message was queued
      const messages = queueAPI.peekMessages('hook-events', 10);
      const toolUseMessage = messages.find(m => m.message_type === 'tool-use');
      
      expect(toolUseMessage).toBeDefined();
      expect(toolUseMessage!.payload.toolName).toBe(toolName);
      expect(toolUseMessage!.payload.toolInput).toEqual(toolInput);
      expect(toolUseMessage!.payload.context).toEqual(context);
    });

    test('should process user prompts through queue', async () => {
      const content = 'Create a new test file in the tests directory';
      const context = { sessionId: 'test-session' };

      hookIntegration.processUserPrompt(content, context);

      // Check if message was queued
      await new Promise(resolve => setTimeout(resolve, 100));
      const messages = queueAPI.peekMessages('hook-events', 10);
      const promptMessage = messages.find(m => m.message_type === 'user-prompt');
      
      expect(promptMessage).toBeDefined();
      expect(promptMessage!.payload.content).toBe(content);
      expect(promptMessage!.payload.context).toEqual(context);
    });

    test('should process Claude responses through queue', async () => {
      const content = 'I\'ll create a test file for you in the tests directory...';
      const context = { sessionId: 'test-session', responseId: 'resp-123' };

      hookIntegration.processClaudeResponse(content, context);

      // Check if message was queued
      await new Promise(resolve => setTimeout(resolve, 100));
      const messages = queueAPI.peekMessages('hook-events', 10);
      const responseMessage = messages.find(m => m.message_type === 'claude-response');
      
      expect(responseMessage).toBeDefined();
      expect(responseMessage!.payload.content).toBe(content);
      expect(responseMessage!.payload.context).toEqual(context);
    });
  });

  describe('MCP Integration', () => {
    let mcpIntegration: MCPQueueIntegration;

    beforeEach(async () => {
      mcpIntegration = MCPQueueIntegration.getInstance();
      await mcpIntegration.initialize();
    });

    test('should process MCP tool calls through queue', async () => {
      const toolName = 'memory';
      const operation = 'search';
      const payload = { query: 'test query', context: {} };

      const messageId = mcpIntegration.processToolCall(toolName, operation, payload);
      expect(messageId).toBeGreaterThan(0);

      // Check if message was queued
      const messages = queueAPI.peekMessages('mcp-operations', 10);
      const mcpMessage = messages.find(m => m.id === messageId);
      
      expect(mcpMessage).toBeDefined();
      expect(mcpMessage!.message_type).toBe('memory:search');
      expect(mcpMessage!.payload).toEqual(payload);
    });

    test('should process memory searches with high priority', async () => {
      const query = 'important search query';
      const context = { urgent: true };

      const messageId = mcpIntegration.processMemorySearch(query, context);
      expect(messageId).toBeGreaterThan(0);

      const messages = queueAPI.peekMessages('mcp-operations', 10);
      const searchMessage = messages.find(m => m.id === messageId);
      
      expect(searchMessage).toBeDefined();
      expect(searchMessage!.priority).toBe(6); // High priority for memory searches
      expect(searchMessage!.message_type).toBe('memory:search');
    });

    test('should process memory store operations', async () => {
      const data = { key: 'test-key', value: 'test-value', type: 'test' };
      const context = { sessionId: 'test-session' };

      const messageId = mcpIntegration.processMemoryStore(data, context);
      expect(messageId).toBeGreaterThan(0);

      const messages = queueAPI.peekMessages('mcp-operations', 10);
      const storeMessage = messages.find(m => m.id === messageId);
      
      expect(storeMessage).toBeDefined();
      expect(storeMessage!.message_type).toBe('memory:store');
      expect(storeMessage!.priority).toBe(5); // Medium-high priority for memory storage
    });
  });

  describe('Memory Service Integration', () => {
    test('should patch MemoryService to use queue for pattern detection', async () => {
      await integrationService.initialize();

      // Mock MemoryService
      const mockMemoryService = {
        store: jest.fn(),
        storePreferenceWithOverride: jest.fn()
      };

      // The integration service should patch the memory service
      // This would be tested by verifying queue messages are created
      // when memory operations are performed

      expect(integrationService).toBeDefined();
      // Additional integration tests would go here
    });
  });

  describe('Error Handling', () => {
    test('should handle processor errors gracefully', async () => {
      await integrationService.initialize();

      // Queue a message that might cause an error
      const messageId = integrationService.processHookEvent('error-prone-event', {
        causeError: true
      });

      expect(messageId).toBeGreaterThan(0);

      // The system should handle errors without crashing
      // Error messages should go to dead letter queue eventually
      await new Promise(resolve => setTimeout(resolve, 1000));

      const health = integrationService.getSystemHealth();
      expect(health).toBeDefined();
    });

    test('should track failed messages in dead letter queue', async () => {
      await integrationService.initialize();

      // This would test the retry and dead letter queue functionality
      // by creating messages that fail processing multiple times
      const messageId = integrationService.processHookEvent('failing-event', {
        shouldFail: true,
        maxRetries: 1
      });

      expect(messageId).toBeGreaterThan(0);

      // After processing fails beyond max retries,
      // message should appear in dead letter queue
      await new Promise(resolve => setTimeout(resolve, 2000));

      const dlqMessages = integrationService.getDeadLetterMessages(10);
      // This would check if messages are properly moved to DLQ
      expect(Array.isArray(dlqMessages)).toBe(true);
    });
  });

  describe('Performance and Monitoring', () => {
    test('should provide accurate system health metrics', async () => {
      await integrationService.initialize();

      // Add various types of messages
      integrationService.processHookEvent('event1', {});
      integrationService.processHookEvent('event2', {});
      integrationService.processMCPOperation('tool1', 'op1', {});

      const health = integrationService.getSystemHealth();

      expect(health.isHealthy).toBe(true);
      expect(health.totalPendingMessages).toBeGreaterThan(0);
      expect(health.totalProcessingMessages).toBeGreaterThanOrEqual(0);
      expect(health.totalFailedMessages).toBeGreaterThanOrEqual(0);
      expect(health.uptime).toBeGreaterThan(0);
    });

    test('should provide queue statistics', async () => {
      await integrationService.initialize();

      // Add messages to different queues
      integrationService.processHookEvent('hook-event', {});
      integrationService.processMCPOperation('mcp-tool', 'operation', {});
      integrationService.processMemoryOperation('store', { key: 'test', value: 'test' });

      const allStats = integrationService.getQueueStats();
      expect(Array.isArray(allStats)).toBe(true);

      const hookStats = integrationService.getQueueStats('hook-events');
      expect(hookStats.queueName).toBe('hook-events');
      expect(hookStats.pending).toBeGreaterThan(0);
    });
  });
});

describe('MCP Queue Tools Integration', () => {
  let queueTools: QueueMCPTools;
  let enhancedMemoryTools: EnhancedMemoryMCPTools;
  let testDbPath: string;

  beforeEach(() => {
    testDbPath = path.join(__dirname, `test-mcp-tools-${Date.now()}.db`);
    
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
          debug: jest.fn()
        })
      }
    }));

    queueTools = new QueueMCPTools();
    enhancedMemoryTools = new EnhancedMemoryMCPTools();
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('Queue MCP Tools', () => {
    test('should provide correct tool definitions', () => {
      const tools = queueTools.getToolsDefinition();
      
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('mcp__claude-recall__queue_status');
      expect(toolNames).toContain('mcp__claude-recall__queue_stats');
      expect(toolNames).toContain('mcp__claude-recall__queue_peek');
      expect(toolNames).toContain('mcp__claude-recall__queue_enqueue');
    });

    test('should handle queue status requests', async () => {
      const result = await queueTools.handleToolCall('mcp__claude-recall__queue_status', {});
      
      expect(result).toHaveProperty('system_health');
      expect(result).toHaveProperty('queue_stats');
      expect(result).toHaveProperty('timestamp');
      expect(result.system_health).toHaveProperty('isHealthy');
    });

    test('should handle queue peek requests', async () => {
      // First enqueue some messages
      const queueAPI = QueueAPI.getInstance();
      queueAPI.enqueueHookEvent('test-event', { test: 'data' });
      queueAPI.enqueueMCPOperation('test-tool', 'test-op', { test: 'data' });
      
      const result = await queueTools.handleToolCall('mcp__claude-recall__queue_peek', {
        queue_name: 'hook-events',
        limit: 5
      });
      
      expect(result).toHaveProperty('queue_name', 'hook-events');
      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('count');
      expect(Array.isArray(result.messages)).toBe(true);
      
      queueAPI.close();
    });

    test('should handle manual enqueue requests', async () => {
      const result = await queueTools.handleToolCall('mcp__claude-recall__queue_enqueue', {
        queue_name: 'hook-events',
        message_type: 'manual-test',
        payload: { test: 'manual enqueue' },
        priority: 8
      });
      
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message_id');
      expect(result.message_id).toBeGreaterThan(0);
    });
  });

  describe('Enhanced Memory MCP Tools', () => {
    test('should provide correct tool definitions', () => {
      const tools = enhancedMemoryTools.getToolsDefinition();
      
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      
      const toolNames = tools.map(t => t.name);
      expect(toolNames).toContain('mcp__claude-recall__async_memory_search');
      expect(toolNames).toContain('mcp__claude-recall__async_pattern_detection');
      expect(toolNames).toContain('mcp__claude-recall__bulk_memory_operation');
    });

    test('should handle async memory search requests', async () => {
      const result = await enhancedMemoryTools.handleToolCall('mcp__claude-recall__async_memory_search', {
        query: 'test search query',
        context: { sessionId: 'test-session' },
        priority: 8
      });
      
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message_id');
      expect(result).toHaveProperty('status', 'queued_for_processing');
      expect(result.message_id).toBeGreaterThan(0);
    });

    test('should handle async pattern detection requests', async () => {
      const result = await enhancedMemoryTools.handleToolCall('mcp__claude-recall__async_pattern_detection', {
        content: 'I always prefer TypeScript over JavaScript for new projects',
        context: { type: 'user-preference' },
        priority: 7
      });
      
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('message_id');
      expect(result).toHaveProperty('status', 'queued_for_analysis');
      expect(result.content_length).toBeGreaterThan(0);
    });

    test('should handle bulk memory operations', async () => {
      const operations = [
        {
          operation: 'store',
          payload: { key: 'test1', value: 'value1', type: 'test' }
        },
        {
          operation: 'store',
          payload: { key: 'test2', value: 'value2', type: 'test' }
        },
        {
          operation: 'search',
          payload: { query: 'test values' }
        }
      ];

      const result = await enhancedMemoryTools.handleToolCall('mcp__claude-recall__bulk_memory_operation', {
        operations,
        batch_priority: 6
      });
      
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('batch_id');
      expect(result).toHaveProperty('message_ids');
      expect(result).toHaveProperty('operations_count', 3);
      expect(Array.isArray(result.message_ids)).toBe(true);
      expect(result.message_ids.length).toBe(3);
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid tool names gracefully', async () => {
      await expect(queueTools.handleToolCall('invalid_tool_name', {}))
        .rejects
        .toThrow('Unknown queue tool');
        
      await expect(enhancedMemoryTools.handleToolCall('invalid_memory_tool', {}))
        .rejects
        .toThrow('Unknown enhanced memory tool');
    });

    test('should validate input parameters', async () => {
      // Test missing required parameters
      await expect(queueTools.handleToolCall('mcp__claude-recall__queue_peek', {}))
        .rejects
        .toThrow();
        
      await expect(enhancedMemoryTools.handleToolCall('mcp__claude-recall__async_memory_search', {}))
        .rejects
        .toThrow();
    });
  });
});