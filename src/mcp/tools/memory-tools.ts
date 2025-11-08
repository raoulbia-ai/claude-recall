import { MemoryService } from '../../services/memory';
import { LoggingService } from '../../services/logging';
import { SearchMonitor } from '../../services/search-monitor';
import { MCPTool, MCPContext } from '../server';

export class MemoryTools {
  private tools: MCPTool[] = [];
  private searchMonitor: SearchMonitor;
  
  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.searchMonitor = SearchMonitor.getInstance();
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
            },
            scope: {
              type: 'string',
              enum: ['universal', 'project'],
              description: 'Memory scope: "universal" (available in all projects) or "project" (current project only). Default: unscoped (available everywhere for backward compatibility)'
            }
          },
          required: ['content']
        },
        handler: this.handleStoreMemory.bind(this)
      },
      {
        name: 'mcp__claude-recall__retrieve_memory',
        description: 'Get relevant memories by ID, query, or recency. Use sortBy="timestamp" for most recent memories.',
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
            },
            sortBy: {
              type: 'string',
              enum: ['relevance', 'timestamp'],
              description: 'Sort order: "relevance" (default, keyword-based) or "timestamp" (newest first)'
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
                  description: 'Filter by project ID (includes universal memories)'
                },
                globalSearch: {
                  type: 'boolean',
                  description: 'Search all projects (ignores projectId filter)'
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
      },
      {
        name: 'mcp__claude-recall__store_preferences',
        description: 'Store extracted preferences from conversation analysis (Phase 2). Use this after analyzing conversation with analyze-for-preferences prompt.',
        inputSchema: {
          type: 'object',
          properties: {
            preferences: {
              type: 'array',
              description: 'Array of extracted preferences from Claude Code analysis',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', description: 'Preference key (e.g., "test_location", "code_style")' },
                  value: { description: 'Preference value (string or object)' },
                  confidence: { type: 'number', description: 'Confidence score (0.0-1.0)' },
                  reasoning: { type: 'string', description: 'Why this is a preference' }
                },
                required: ['key', 'value', 'confidence']
              }
            },
            sessionId: {
              type: 'string',
              description: 'Session ID for the analyzed conversation'
            }
          },
          required: ['preferences']
        },
        handler: this.handleStorePreferences.bind(this)
      },
      {
        name: 'mcp__claude-recall__get_recent_captures',
        description: 'Get information about memories that were automatically captured in this session. Use this to see what information has already been stored.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximum number of recent captures to return (default: 5)'
            }
          }
        },
        handler: this.handleGetRecentCaptures.bind(this)
      }
    ];
  }

  /**
   * Estimate tokens in search results
   * Uses rough approximation: 1 token ≈ 4 characters
   */
  private estimateTokens(results: any[]): number {
    let totalChars = 0;
    for (const result of results) {
      const content = typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
      totalChars += content.length;
    }
    // Rough token estimate: 1 token ≈ 4 characters
    return Math.ceil(totalChars / 4);
  }

  /**
   * Estimate tokens saved by using search vs alternatives
   * - Loading all reference files: ~8,000 tokens
   * - Repeating preferences in context: ~200 tokens per preference
   */
  private estimateTokenSavings(resultsCount: number, query: string): number {
    if (resultsCount === 0) {
      return 0;
    }

    // Detect what type of search this is based on query keywords
    const lowerQuery = query.toLowerCase();
    const isDevOpsSearch = ['git', 'test', 'deploy', 'build', 'docker', 'ci', 'cd', 'workflow'].some(kw => lowerQuery.includes(kw));
    const isPreferenceSearch = ['prefer', 'style', 'convention', 'always', 'never'].some(kw => lowerQuery.includes(kw));

    let baselineCost = 0;

    if (isDevOpsSearch) {
      // Alternative: Loading devops reference files (1,500 tokens each × 6 files)
      baselineCost = 9000;
    } else if (isPreferenceSearch) {
      // Alternative: User repeating preferences (200 tokens each)
      baselineCost = resultsCount * 200;
    } else {
      // Generic search - alternative is asking user to repeat (300 tokens per item)
      baselineCost = resultsCount * 300;
    }

    return baselineCost;
  }

  private async handleStoreMemory(input: any, context: MCPContext): Promise<any> {
    try {
      const { content, metadata, scope } = input;

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
          projectId: scope === 'project' ? context.projectId : undefined,
          timestamp: context.timestamp,
          scope: scope || null
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
      let { query, id, limit = 10, sortBy } = input;

      // Smart detection: Auto-detect timestamp sorting from query keywords
      if (!sortBy && query) {
        const timeKeywords = ['recent', 'latest', 'newest', 'last', 'new'];
        const lowerQuery = query.toLowerCase();
        if (timeKeywords.some(kw => lowerQuery.includes(kw))) {
          sortBy = 'timestamp';
          this.logger.debug('MemoryTools', 'Auto-detected timestamp sorting', { query });
        }
      }

      // Default to relevance sorting
      if (!sortBy) {
        sortBy = 'relevance';
      }

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
        // Search for relevant memories with sort option
        const results = this.memoryService.search(query, sortBy);
        const limitedResults = results.slice(0, limit);

        return {
          memories: limitedResults.map(r => ({
            ...r,
            relevanceScore: r.score
          })),
          count: limitedResults.length,
          totalFound: results.length,
          sortBy
        };
      }

      // Get recent memories from context
      const contextResults = this.memoryService.findRelevant({
        sessionId: context.sessionId,
        projectId: context.projectId,
        timestamp: context.timestamp
      }, sortBy);

      const limitedResults = contextResults.slice(0, limit);

      return {
        memories: limitedResults.map(r => ({
          ...r,
          relevanceScore: r.score
        })),
        count: limitedResults.length,
        sortBy
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

          // Global search: include all memories
          if (filters.globalSearch) {
            return true;
          }

          // Project-scoped search: include project + universal + unscoped memories
          if (filters.projectId) {
            return result.project_id === filters.projectId ||
                   result.scope === 'universal' ||
                   result.project_id === null;
          }

          return true;
        });
      }
      
      const limitedResults = filteredResults.slice(0, limit);

      // Calculate token metrics
      const resultTokens = this.estimateTokens(limitedResults);
      const tokensSaved = this.estimateTokenSavings(limitedResults.length, query);

      // Record the search for monitoring
      this.searchMonitor.recordSearch(
        query,
        limitedResults.length,
        context.sessionId,
        'mcp',
        { filters, totalResults: results.length, tokenMetrics: { resultTokens, tokensSaved } }
      );

      this.logger.info('MemoryTools', 'Search completed', {
        query,
        totalResults: results.length,
        filteredResults: filteredResults.length,
        returnedResults: limitedResults.length,
        tokenMetrics: { resultTokens, tokensSaved }
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
        query,
        tokenMetrics: {
          estimatedTokens: resultTokens,
          estimatedTokensSaved: tokensSaved,
          efficiency: tokensSaved > 0 ? `${Math.round((tokensSaved / (tokensSaved + resultTokens)) * 100)}%` : '0%'
        }
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

  /**
   * Phase 2: Store batch preferences from Claude Code analysis
   */
  private async handleStorePreferences(input: any, context: MCPContext): Promise<any> {
    try {
      const { preferences, sessionId } = input;

      if (!Array.isArray(preferences) || preferences.length === 0) {
        throw new Error('Preferences must be a non-empty array');
      }

      // Validate each preference
      for (const pref of preferences) {
        if (!pref.key || typeof pref.key !== 'string') {
          throw new Error('Each preference must have a string key');
        }
        if (pref.value === undefined) {
          throw new Error('Each preference must have a value');
        }
        if (typeof pref.confidence !== 'number' || pref.confidence < 0 || pref.confidence > 1) {
          throw new Error('Confidence must be a number between 0 and 1');
        }
      }

      // Store each preference
      const stored = [];
      for (const pref of preferences) {
        const memoryKey = `pref_${pref.key}_${Date.now()}`;

        await this.memoryService.store({
          key: memoryKey,
          value: {
            value: pref.value,
            confidence: pref.confidence,
            reasoning: pref.reasoning || '',
            source: 'claude-analysis',
            analyzedAt: Date.now(),
            sessionId: sessionId || context.sessionId
          },
          type: 'preference',
          context: {
            sessionId: sessionId || context.sessionId,
            timestamp: Date.now()
          }
        });

        stored.push({
          key: pref.key,
          memoryId: memoryKey,
          confidence: pref.confidence
        });

        this.logger.info('MemoryTools', 'Stored analyzed preference', {
          key: pref.key,
          confidence: pref.confidence,
          sessionId: sessionId || context.sessionId
        });
      }

      this.logger.info('MemoryTools', 'Batch preferences stored', {
        count: stored.length,
        sessionId: sessionId || context.sessionId
      });

      return {
        success: true,
        stored: stored.length,
        preferences: stored,
        message: `Successfully stored ${stored.length} preferences from analysis`
      };

    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to store preferences', error);
      throw error;
    }
  }

  /**
   * Get recently automatically-captured memories for this session
   */
  private async handleGetRecentCaptures(input: any, context: MCPContext): Promise<any> {
    try {
      const { limit = 5 } = input;

      // Search for recent auto-captured memories
      // We look for memories with keys starting with "auto_" or having auto_capture context
      const allMemories = this.memoryService.search('');

      // Filter to auto-captured memories from recent sessions
      const autoCaptures = allMemories
        .filter(m => {
          // Check if it's an auto-captured memory
          if (m.key && (m.key.startsWith('auto_') || m.key.startsWith('pref_'))) {
            return true;
          }
          // Check value for auto_capture indicator
          if (m.value && typeof m.value === 'object') {
            const val = m.value as any;
            if (val.source === 'auto_capture' || val.type === 'auto_capture') {
              return true;
            }
          }
          return false;
        })
        .slice(0, limit * 2); // Get more than needed, then filter by time

      // Sort by timestamp (newest first)
      const sorted = autoCaptures.sort((a, b) => {
        const timeA = a.timestamp || 0;
        const timeB = b.timestamp || 0;
        return timeB - timeA;
      });

      const recentCaptures = sorted.slice(0, limit);

      // Format for display
      const formatted = recentCaptures.map(m => ({
        type: m.type,
        content: this.extractCaptureContent(m),
        confidence: this.extractConfidence(m),
        timestamp: m.timestamp,
        key: m.key
      }));

      this.logger.info('MemoryTools', 'Retrieved recent captures', {
        count: formatted.length,
        sessionId: context.sessionId
      });

      return {
        captures: formatted,
        count: formatted.length,
        message: formatted.length > 0
          ? `Found ${formatted.length} automatically captured memories`
          : 'No automatic captures yet in this session',
        tip: formatted.length === 0
          ? 'Memories are captured automatically when you state preferences, provide project info, or make decisions.'
          : 'Consider manually storing additional project details that were mentioned.'
      };

    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to get recent captures', error);
      throw error;
    }
  }

  /**
   * Extract human-readable content from captured memory
   */
  private extractCaptureContent(memory: any): string {
    if (typeof memory.value === 'string') {
      return memory.value;
    }

    if (typeof memory.value === 'object' && memory.value !== null) {
      const val = memory.value as any;
      if (val.raw) return val.raw;
      if (val.content) return val.content;
      if (val.message) return val.message;
      if (val.key && val.value) {
        return `${val.key}: ${typeof val.value === 'object' ? JSON.stringify(val.value) : val.value}`;
      }
      // Fallback: stringify the object
      return JSON.stringify(val);
    }

    return memory.key || 'Unknown content';
  }

  /**
   * Extract confidence score from memory
   */
  private extractConfidence(memory: any): number {
    if (typeof memory.value === 'object' && memory.value !== null) {
      const val = memory.value as any;
      if (typeof val.confidence === 'number') {
        return val.confidence;
      }
    }
    return 0.5; // Default confidence
  }

  getTools(): MCPTool[] {
    return this.tools;
  }
}