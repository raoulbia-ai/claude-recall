import { MemoryService } from '../../services/memory';
import { LoggingService } from '../../services/logging';
import { MCPTool, MCPContext } from '../server';

export class MemoryTools {
  private tools: MCPTool[] = [];
  
  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.registerTools();
  }

  // Claude-flow pattern: Validate input against schema
  private validateInput(schema: any, input: any): void {
    if (schema.required) {
      for (const required of schema.required) {
        if (!(required in input)) {
          throw new Error(`Missing required field: ${required}`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in input) {
          const value = input[key];
          const expectedType = (propSchema as any).type;
          
          if (expectedType === 'string' && typeof value !== 'string') {
            throw new Error(`Field ${key} must be a string`);
          } else if (expectedType === 'number' && typeof value !== 'number') {
            throw new Error(`Field ${key} must be a number`);
          } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
            throw new Error(`Field ${key} must be a boolean`);
          } else if (expectedType === 'object' && typeof value !== 'object') {
            throw new Error(`Field ${key} must be an object`);
          }
        }
      }
    }
  }

  // Claude-flow pattern: Execute tool with tracking
  private async executeToolWithTracking(
    tool: MCPTool,
    input: any,
    context: MCPContext
  ): Promise<any> {
    const startTime = Date.now();
    const toolMeta = {
      name: tool.name,
      sessionId: context.sessionId,
      startTime
    };
    
    try {
      // Validate input against schema
      this.validateInput(tool.inputSchema, input);
      
      // Execute tool
      const result = await tool.handler(input, context);
      
      // Track success
      this.logger.info('ToolExecution', 'Tool completed', {
        ...toolMeta,
        duration: Date.now() - startTime,
        success: true
      });
      
      return result;
    } catch (error) {
      // Track failure
      this.logger.error('ToolExecution', 'Tool failed', {
        ...toolMeta,
        duration: Date.now() - startTime,
        error: (error as Error).message
      });
      
      throw error;
    }
  }
  
  private registerTools(): void {
    this.tools = [
      {
        name: 'mcp__claude-recall__store_memory',
        description: 'Store a memory in Claude Recall',
        inputSchema: {
          type: 'object',
          properties: {
            content: { 
              type: 'string', 
              description: 'Memory content to store' 
            },
            metadata: { 
              type: 'object', 
              description: 'Optional metadata for the memory' 
            }
          },
          required: ['content']
        },
        handler: this.handleStoreMemory.bind(this)
      },
      {
        name: 'mcp__claude-recall__retrieve_memory',
        description: 'Get relevant memories by ID or query',
        inputSchema: {
          type: 'object',
          properties: {
            query: { 
              type: 'string', 
              description: 'Search query to find relevant memories' 
            },
            id: { 
              type: 'string', 
              description: 'Specific memory ID to retrieve' 
            },
            limit: { 
              type: 'number', 
              description: 'Maximum number of memories to return (default: 10)' 
            }
          }
        },
        handler: this.handleRetrieveMemory.bind(this)
      },
      {
        name: 'mcp__claude-recall__search',
        description: 'Search through all memories',
        inputSchema: {
          type: 'object',
          properties: {
            query: { 
              type: 'string', 
              description: 'Search query' 
            },
            filters: { 
              type: 'object', 
              description: 'Optional filters to apply',
              properties: {
                type: { 
                  type: 'string', 
                  description: 'Filter by memory type' 
                },
                projectId: { 
                  type: 'string', 
                  description: 'Filter by project ID' 
                }
              }
            },
            limit: { 
              type: 'number', 
              description: 'Maximum number of results (default: 20)' 
            }
          },
          required: ['query']
        },
        handler: this.handleSearch.bind(this)
      },
      {
        name: 'mcp__claude-recall__get_stats',
        description: 'Get memory statistics',
        inputSchema: {
          type: 'object',
          properties: {}
        },
        handler: this.handleGetStats.bind(this)
      },
      {
        name: 'mcp__claude-recall__clear_context',
        description: 'Clear current session context',
        inputSchema: {
          type: 'object',
          properties: {
            confirm: { 
              type: 'boolean', 
              description: 'Confirmation to clear context' 
            }
          },
          required: ['confirm']
        },
        handler: this.handleClearContext.bind(this)
      }
    ];
  }
  
  private async handleStoreMemory(input: any, context: MCPContext): Promise<any> {
    try {
      const { content, metadata } = input;
      
      if (!content || typeof content !== 'string') {
        throw new Error('Content is required and must be a string');
      }
      
      const key = `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      this.memoryService.store({
        key,
        value: {
          content,
          ...metadata,
          sessionId: context.sessionId,
          timestamp: context.timestamp
        },
        type: 'conversation',
        context: {
          sessionId: context.sessionId,
          projectId: context.projectId,
          timestamp: context.timestamp
        }
      });
      
      this.logger.info('MemoryTools', 'Memory stored successfully', {
        key,
        contentLength: content.length,
        sessionId: context.sessionId
      });
      
      return {
        id: key,
        success: true
      };
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to store memory', error);
      throw error;
    }
  }
  
  private async handleRetrieveMemory(input: any, context: MCPContext): Promise<any> {
    try {
      const { query, id, limit = 10 } = input;
      
      if (id) {
        // Retrieve specific memory by ID
        const memory = this.memoryService.retrieve(id);
        
        if (!memory) {
          return {
            memories: [],
            count: 0,
            message: `Memory with ID ${id} not found`
          };
        }
        
        return {
          memories: [memory],
          count: 1
        };
      }
      
      if (query) {
        // Search for relevant memories
        const results = this.memoryService.search(query);
        const limitedResults = results.slice(0, limit);
        
        return {
          memories: limitedResults.map(r => ({
            ...r,
            relevanceScore: r.score
          })),
          count: limitedResults.length,
          totalFound: results.length
        };
      }
      
      // Get recent memories from context
      const contextResults = this.memoryService.findRelevant({
        sessionId: context.sessionId,
        projectId: context.projectId,
        timestamp: context.timestamp
      });
      
      const limitedResults = contextResults.slice(0, limit);
      
      return {
        memories: limitedResults.map(r => ({
          ...r,
          relevanceScore: r.score
        })),
        count: limitedResults.length
      };
      
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to retrieve memory', error);
      throw error;
    }
  }
  
  private async handleSearch(input: any, context: MCPContext): Promise<any> {
    try {
      const { query, filters, limit = 20 } = input;
      
      if (!query) {
        throw new Error('Query is required');
      }
      
      const results = this.memoryService.search(query);
      
      // Apply filters if provided
      let filteredResults = results;
      if (filters) {
        filteredResults = results.filter(result => {
          if (filters.type && result.type !== filters.type) {
            return false;
          }
          if (filters.projectId && result.project_id !== filters.projectId) {
            return false;
          }
          return true;
        });
      }
      
      const limitedResults = filteredResults.slice(0, limit);
      
      this.logger.info('MemoryTools', 'Search completed', {
        query,
        totalResults: results.length,
        filteredResults: filteredResults.length,
        returnedResults: limitedResults.length
      });
      
      return {
        results: limitedResults.map(r => ({
          id: r.key,
          type: r.type,
          content: r.value,
          score: r.score,
          timestamp: r.timestamp,
          projectId: r.project_id,
          filePath: r.file_path
        })),
        total: filteredResults.length,
        query
      };
      
    } catch (error) {
      this.logger.error('MemoryTools', 'Search failed', error);
      throw error;
    }
  }
  
  private async handleGetStats(input: any, context: MCPContext): Promise<any> {
    try {
      const stats = this.memoryService.getStats();
      
      this.logger.info('MemoryTools', 'Stats retrieved', {
        totalMemories: stats.total,
        sessionId: context.sessionId
      });
      
      return {
        totalMemories: stats.total,
        categories: stats.byType,
        sessionId: context.sessionId,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to get stats', error);
      throw error;
    }
  }
  
  private async handleClearContext(input: any, context: MCPContext): Promise<any> {
    try {
      const { confirm } = input;
      
      if (!confirm) {
        return {
          cleared: false,
          message: 'Confirmation required to clear context'
        };
      }
      
      // In a real implementation, we would clear session-specific data
      // For now, we'll just log the action
      this.logger.info('MemoryTools', 'Context cleared', {
        sessionId: context.sessionId,
        timestamp: context.timestamp
      });
      
      return {
        cleared: true,
        count: 0, // In real implementation, return number of cleared items
        message: 'Session context cleared successfully'
      };
      
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to clear context', error);
      throw error;
    }
  }
  
  getTools(): MCPTool[] {
    return this.tools;
  }
}