import { QueueIntegrationService, MCPQueueIntegration } from '../services/queue-integration';
import { QueueAPI } from '../services/queue-api';
import { LoggingService } from '../services/logging';

/**
 * MCP Tools for queue management and monitoring
 * These tools provide Claude Code with queue system capabilities
 */
export class QueueMCPTools {
  private queueAPI: QueueAPI;
  private integrationService: QueueIntegrationService;
  private mcpIntegration: MCPQueueIntegration;
  private logger = LoggingService.getInstance();

  constructor() {
    this.queueAPI = QueueAPI.getInstance();
    this.integrationService = QueueIntegrationService.getInstance();
    this.mcpIntegration = MCPQueueIntegration.getInstance();
  }

  /**
   * Get available queue MCP tools
   */
  getToolsDefinition(): any[] {
    return [
      {
        name: 'mcp__claude-recall__queue_status',
        description: 'Get queue system status and health information',
        inputSchema: {
          type: 'object',
          properties: {
            queue_name: {
              type: 'string',
              description: 'Optional specific queue name to check'
            }
          }
        }
      },
      {
        name: 'mcp__claude-recall__queue_stats',
        description: 'Get detailed statistics for queues',
        inputSchema: {
          type: 'object',
          properties: {
            queue_name: {
              type: 'string',
              description: 'Specific queue name to get stats for'
            }
          }
        }
      },
      {
        name: 'mcp__claude-recall__queue_peek',
        description: 'Peek at pending messages in a queue without removing them',
        inputSchema: {
          type: 'object',
          properties: {
            queue_name: {
              type: 'string',
              description: 'Name of the queue to peek into',
              enum: ['hook-events', 'mcp-operations', 'memory-operations', 'pattern-detection']
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to peek at',
              default: 10,
              minimum: 1,
              maximum: 100
            }
          },
          required: ['queue_name']
        }
      },
      {
        name: 'mcp__claude-recall__queue_enqueue',
        description: 'Manually enqueue a message for processing',
        inputSchema: {
          type: 'object',
          properties: {
            queue_name: {
              type: 'string',
              description: 'Name of the queue to add message to',
              enum: ['hook-events', 'mcp-operations', 'memory-operations', 'pattern-detection']
            },
            message_type: {
              type: 'string',
              description: 'Type of message being enqueued'
            },
            payload: {
              type: 'object',
              description: 'Message payload data'
            },
            priority: {
              type: 'number',
              description: 'Message priority (higher numbers = higher priority)',
              default: 0,
              minimum: 0,
              maximum: 10
            },
            delay_ms: {
              type: 'number',
              description: 'Delay before processing (milliseconds)',
              minimum: 0
            }
          },
          required: ['queue_name', 'message_type', 'payload']
        }
      },
      {
        name: 'mcp__claude-recall__dead_letter_queue',
        description: 'Get messages from the dead letter queue',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of messages to retrieve',
              default: 20,
              minimum: 1,
              maximum: 100
            }
          }
        }
      },
      {
        name: 'mcp__claude-recall__requeue_dead_letter',
        description: 'Requeue messages from dead letter queue back to processing',
        inputSchema: {
          type: 'object',
          properties: {
            message_ids: {
              type: 'array',
              description: 'Array of dead letter message IDs to requeue',
              items: {
                type: 'number'
              },
              minItems: 1
            }
          },
          required: ['message_ids']
        }
      },
      {
        name: 'mcp__claude-recall__queue_cleanup',
        description: 'Manually trigger cleanup of old completed messages',
        inputSchema: {
          type: 'object',
          properties: {
            older_than_days: {
              type: 'number',
              description: 'Remove completed messages older than this many days',
              default: 1,
              minimum: 0.1,
              maximum: 30
            }
          }
        }
      }
    ];
  }

  /**
   * Handle queue MCP tool calls
   */
  async handleToolCall(toolName: string, input: any): Promise<any> {
    try {
      this.logger.info('QueueMCPTools', `Handling tool call: ${toolName}`, { input });

      switch (toolName) {
        case 'mcp__claude-recall__queue_status':
          return await this.handleQueueStatus(input);

        case 'mcp__claude-recall__queue_stats':
          return await this.handleQueueStats(input);

        case 'mcp__claude-recall__queue_peek':
          return await this.handleQueuePeek(input);

        case 'mcp__claude-recall__queue_enqueue':
          return await this.handleQueueEnqueue(input);

        case 'mcp__claude-recall__dead_letter_queue':
          return await this.handleDeadLetterQueue(input);

        case 'mcp__claude-recall__requeue_dead_letter':
          return await this.handleRequeueDeadLetter(input);

        case 'mcp__claude-recall__queue_cleanup':
          return await this.handleQueueCleanup(input);

        default:
          throw new Error(`Unknown queue tool: ${toolName}`);
      }
    } catch (error) {
      this.logger.error('QueueMCPTools', `Error handling tool call: ${toolName}`, error);
      throw error;
    }
  }

  /**
   * Handle queue status requests
   */
  private async handleQueueStatus(input: { queue_name?: string }): Promise<any> {
    const health = this.integrationService.getSystemHealth();
    
    if (input.queue_name) {
      const stats = this.integrationService.getQueueStats(input.queue_name);
      return {
        queue_name: input.queue_name,
        stats,
        system_health: health,
        timestamp: new Date().toISOString()
      };
    }

    const allStats = this.integrationService.getQueueStats() as any[];
    return {
      system_health: health,
      queue_stats: allStats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle queue statistics requests
   */
  private async handleQueueStats(input: { queue_name?: string }): Promise<any> {
    if (input.queue_name) {
      const stats = this.integrationService.getQueueStats(input.queue_name);
      return {
        queue_name: input.queue_name,
        ...stats,
        timestamp: new Date().toISOString()
      };
    }

    const allStats = this.integrationService.getQueueStats() as any[];
    return {
      queues: allStats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle queue peek requests
   */
  private async handleQueuePeek(input: { queue_name: string; limit?: number }): Promise<any> {
    const limit = input.limit || 10;
    const messages = this.queueAPI.peekMessages(input.queue_name, limit);
    
    return {
      queue_name: input.queue_name,
      messages,
      count: messages.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle queue enqueue requests
   */
  private async handleQueueEnqueue(input: {
    queue_name: string;
    message_type: string;
    payload: any;
    priority?: number;
    delay_ms?: number;
  }): Promise<any> {
    const messageId = this.queueAPI['queueSystem'].enqueue(
      input.queue_name,
      input.message_type,
      input.payload,
      {
        priority: input.priority,
        scheduledAt: input.delay_ms ? Date.now() + input.delay_ms : undefined
      }
    );

    return {
      success: true,
      message_id: messageId,
      queue_name: input.queue_name,
      message_type: input.message_type,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle dead letter queue requests
   */
  private async handleDeadLetterQueue(input: { limit?: number }): Promise<any> {
    const limit = input.limit || 20;
    const messages = this.integrationService.getDeadLetterMessages(limit);
    
    return {
      messages,
      count: messages.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle requeue from dead letter requests
   */
  private async handleRequeueDeadLetter(input: { message_ids: number[] }): Promise<any> {
    const requeuedCount = this.integrationService.requeueFromDeadLetter(input.message_ids);
    
    return {
      success: true,
      requeued_count: requeuedCount,
      requested_count: input.message_ids.length,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle queue cleanup requests
   */
  private async handleQueueCleanup(input: { older_than_days?: number }): Promise<any> {
    const olderThanDays = input.older_than_days || 1;
    const cleanedCount = this.queueAPI.purgeCompletedMessages(olderThanDays);
    
    return {
      success: true,
      cleaned_count: cleanedCount,
      older_than_days: olderThanDays,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Enhanced memory tools that integrate with the queue system
 */
export class EnhancedMemoryMCPTools {
  private queueAPI: QueueAPI;
  private mcpIntegration: MCPQueueIntegration;
  private logger = LoggingService.getInstance();

  constructor() {
    this.queueAPI = QueueAPI.getInstance();
    this.mcpIntegration = MCPQueueIntegration.getInstance();
  }

  /**
   * Get enhanced memory tool definitions
   */
  getToolsDefinition(): any[] {
    return [
      {
        name: 'mcp__claude-recall__async_memory_search',
        description: 'Perform asynchronous memory search with queue-based processing',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query for memory retrieval'
            },
            context: {
              type: 'object',
              description: 'Context information for search',
              properties: {
                projectId: { type: 'string' },
                filePath: { type: 'string' },
                sessionId: { type: 'string' }
              }
            },
            priority: {
              type: 'number',
              description: 'Search priority (1-10, higher is more urgent)',
              default: 5,
              minimum: 1,
              maximum: 10
            }
          },
          required: ['query']
        }
      },
      {
        name: 'mcp__claude-recall__async_pattern_detection',
        description: 'Queue content for asynchronous pattern detection and analysis',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Content to analyze for patterns'
            },
            context: {
              type: 'object',
              description: 'Context information for pattern detection',
              properties: {
                type: { type: 'string' },
                projectId: { type: 'string' },
                filePath: { type: 'string' },
                sessionId: { type: 'string' }
              }
            },
            priority: {
              type: 'number',
              description: 'Processing priority (1-10)',
              default: 3,
              minimum: 1,
              maximum: 10
            }
          },
          required: ['content']
        }
      },
      {
        name: 'mcp__claude-recall__bulk_memory_operation',
        description: 'Perform bulk memory operations asynchronously through the queue',
        inputSchema: {
          type: 'object',
          properties: {
            operations: {
              type: 'array',
              description: 'Array of memory operations to perform',
              items: {
                type: 'object',
                properties: {
                  operation: {
                    type: 'string',
                    enum: ['store', 'search', 'update', 'delete'],
                    description: 'Type of memory operation'
                  },
                  payload: {
                    type: 'object',
                    description: 'Operation-specific data'
                  }
                },
                required: ['operation', 'payload']
              },
              minItems: 1,
              maxItems: 50
            },
            batch_priority: {
              type: 'number',
              description: 'Priority for the entire batch',
              default: 4,
              minimum: 1,
              maximum: 10
            }
          },
          required: ['operations']
        }
      }
    ];
  }

  /**
   * Handle enhanced memory tool calls
   */
  async handleToolCall(toolName: string, input: any): Promise<any> {
    try {
      this.logger.info('EnhancedMemoryMCPTools', `Handling tool call: ${toolName}`, { input });

      switch (toolName) {
        case 'mcp__claude-recall__async_memory_search':
          return await this.handleAsyncMemorySearch(input);

        case 'mcp__claude-recall__async_pattern_detection':
          return await this.handleAsyncPatternDetection(input);

        case 'mcp__claude-recall__bulk_memory_operation':
          return await this.handleBulkMemoryOperation(input);

        default:
          throw new Error(`Unknown enhanced memory tool: ${toolName}`);
      }
    } catch (error) {
      this.logger.error('EnhancedMemoryMCPTools', `Error handling tool call: ${toolName}`, error);
      throw error;
    }
  }

  /**
   * Handle asynchronous memory search
   */
  private async handleAsyncMemorySearch(input: {
    query: string;
    context?: any;
    priority?: number;
  }): Promise<any> {
    const messageId = this.mcpIntegration.processMemorySearch(
      input.query,
      input.context || {}
    );

    return {
      success: true,
      message_id: messageId,
      query: input.query,
      status: 'queued_for_processing',
      estimated_processing_time: '1-5 seconds',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle asynchronous pattern detection
   */
  private async handleAsyncPatternDetection(input: {
    content: string;
    context?: any;
    priority?: number;
  }): Promise<any> {
    const messageId = this.queueAPI.enqueuePatternDetection(
      input.content,
      input.context || {},
      {
        priority: input.priority || 3,
        correlationId: `pattern-${Date.now()}`
      }
    );

    return {
      success: true,
      message_id: messageId,
      content_length: input.content.length,
      status: 'queued_for_analysis',
      estimated_processing_time: '5-15 seconds',
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle bulk memory operations
   */
  private async handleBulkMemoryOperation(input: {
    operations: Array<{ operation: string; payload: any }>;
    batch_priority?: number;
  }): Promise<any> {
    const messageIds: number[] = [];
    const batchId = `batch-${Date.now()}`;
    const priority = input.batch_priority || 4;

    for (let i = 0; i < input.operations.length; i++) {
      const op = input.operations[i];
      const messageId = this.queueAPI.enqueueMemoryOperation(
        op.operation as any,
        op.payload,
        {
          priority,
          correlationId: `${batchId}-${i}`
        }
      );
      messageIds.push(messageId);
    }

    return {
      success: true,
      batch_id: batchId,
      message_ids: messageIds,
      operations_count: input.operations.length,
      status: 'batch_queued_for_processing',
      estimated_processing_time: `${Math.ceil(input.operations.length / 10)}-${Math.ceil(input.operations.length / 2)} seconds`,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Integration helper to add queue tools to existing MCP server
 */
export class MCPQueueToolsIntegration {
  private queueTools: QueueMCPTools;
  private enhancedMemoryTools: EnhancedMemoryMCPTools;
  private logger = LoggingService.getInstance();

  constructor() {
    this.queueTools = new QueueMCPTools();
    this.enhancedMemoryTools = new EnhancedMemoryMCPTools();
  }

  /**
   * Get all queue-related MCP tools
   */
  getAllToolsDefinition(): any[] {
    return [
      ...this.queueTools.getToolsDefinition(),
      ...this.enhancedMemoryTools.getToolsDefinition()
    ];
  }

  /**
   * Handle any queue-related MCP tool call
   */
  async handleToolCall(toolName: string, input: any): Promise<any> {
    if (toolName.includes('queue_') || toolName.includes('dead_letter') || toolName.includes('cleanup')) {
      return await this.queueTools.handleToolCall(toolName, input);
    } else if (toolName.includes('async_') || toolName.includes('bulk_')) {
      return await this.enhancedMemoryTools.handleToolCall(toolName, input);
    } else {
      throw new Error(`Tool not handled by queue integration: ${toolName}`);
    }
  }

  /**
   * Initialize the queue tools integration
   */
  async initialize(): Promise<void> {
    // Ensure queue integration service is initialized
    const integrationService = QueueIntegrationService.getInstance();
    await integrationService.initialize();

    this.logger.info('MCPQueueToolsIntegration', 'Queue tools integration initialized');
  }
}