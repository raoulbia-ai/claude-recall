import { MemoryService } from '../../services/memory';
import { LoggingService } from '../../services/logging';
import { ConfigService } from '../../services/config';
import { SearchMonitor } from '../../services/search-monitor';
import { SkillGenerator, GenerationResult } from '../../services/skill-generator';
import { MCPTool, MCPContext } from '../server';

export class MemoryTools {
  private static readonly LOAD_RULES_DIRECTIVE =
    'INSTRUCTION: Before your FIRST Write, Edit, or Bash action, you MUST output an\n' +
    '"Applying memories:" section listing which rules below apply to the current task.\n' +
    'If none apply, say so. Do NOT skip this step — the user expects visible confirmation\n' +
    'that you checked your memories before acting.\n' +
    'As you work, cite each applied rule inline: (applied from memory: <rule summary>)\n' +
    'If a rule conflicts with your plan, follow the rule — it reflects a user decision.';

  private tools: MCPTool[] = [];
  private searchMonitor: SearchMonitor;

  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.searchMonitor = SearchMonitor.getInstance();
    this.registerTools();
  }

  private getLoadRulesDirective(): string | undefined {
    const config = ConfigService.getInstance();
    if (config.getConfig().citations?.enabled === false) return undefined;
    return MemoryTools.LOAD_RULES_DIRECTIVE;
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
        name: 'mcp__claude-recall__load_rules',
        description: 'Load all active rules before starting work. Returns preferences, corrections, past failures, and devops rules. Call this once at the start of every task. No query needed.',
        inputSchema: {
          type: 'object',
          properties: {
            projectId: {
              type: 'string',
              description: 'Optional project ID override. Defaults to current project.'
            }
          }
        },
        handler: this.handleLoadRules.bind(this)
      },
      {
        name: 'mcp__claude-recall__store_memory',
        description: 'Store a rule or learning. Use for: corrections, preferences, devops rules, failures. The stored rule is immediately active in this conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'Rule or learning to store'
            },
            metadata: {
              type: 'object',
              description: 'Optional metadata. Set "type" to one of: preference, correction, devops, failure'
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
        name: 'mcp__claude-recall__search_memory',
        description: 'Search memories by keyword. Use to find specific memories before making decisions. Returns matched memories ranked by relevance.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query (keywords to match against stored memories)'
            },
            limit: {
              type: 'number',
              description: 'Maximum results to return (default: 10, max: 25)'
            },
            type: {
              type: 'string',
              description: 'Filter by memory type: preference, correction, devops, failure, project-knowledge'
            },
            projectId: {
              type: 'string',
              description: 'Optional project ID override. Defaults to current project.'
            }
          },
          required: ['query']
        },
        handler: this.handleSearchMemory.bind(this)
      },
      {
        name: 'mcp__claude-recall__delete_memory',
        description: 'Delete a specific memory by its ID (key). Use search_memory first to find the ID of the memory to delete.',
        inputSchema: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'The memory ID (key) to delete. Get this from search_memory or store_memory results.'
            }
          },
          required: ['id']
        },
        handler: this.handleDeleteMemory.bind(this)
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

  private async handleStoreMemory(input: any, context: MCPContext): Promise<any> {
    try {
      const { content, metadata, scope } = input;

      if (!content || typeof content !== 'string') {
        throw new Error('Content is required and must be a string');
      }

      // Use metadata.type as the memory type so it appears in future load_rules calls
      const validTypes = ['preference', 'correction', 'devops', 'failure', 'project-knowledge', 'tool-use'];
      const detectedType = (metadata?.type && validTypes.includes(metadata.type))
        ? metadata.type
        : 'preference';

      const key = `memory_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      this.memoryService.store({
        key,
        value: {
          content,
          ...metadata,
          sessionId: context.sessionId,
          timestamp: context.timestamp
        },
        type: detectedType,
        context: {
          sessionId: context.sessionId,
          projectId: scope === 'project' ? context.projectId : undefined,
          timestamp: context.timestamp,
          scope: scope || null
        }
      });

      this.logger.info('MemoryTools', 'Memory stored successfully', {
        key,
        type: detectedType,
        contentLength: content.length,
        sessionId: context.sessionId
      });

      // Auto-generate skills if thresholds are met
      let skillResults: GenerationResult[] = [];
      try {
        const generator = SkillGenerator.getInstance();
        const projectDir = ConfigService.getInstance().getConfig().project.rootDir;
        skillResults = generator.checkAndGenerate(projectDir, context.projectId);
      } catch (e) {
        // Non-critical — don't fail the store
        this.logger.debug('MemoryTools', 'Skill generation check failed', e);
      }

      return {
        id: key,
        success: true,
        activeRule: `Stored as active rule:\n- ${content}`,
        type: detectedType,
        _directive: 'Apply this rule immediately. No need to call load_rules again.',
        ...(skillResults.length > 0 && {
          _skillsGenerated: skillResults
            .filter(r => r.action === 'created' || r.action === 'updated')
            .map(r => r.topicId)
        })
      };
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to store memory', error);
      throw error;
    }
  }
  
  /**
   * Load all active rules by category - deterministic, no query needed
   */
  private async handleLoadRules(input: any, context: MCPContext): Promise<any> {
    try {
      const { projectId } = input;
      const directive = this.getLoadRulesDirective();
      const rules = this.memoryService.loadActiveRules(projectId || context.projectId);

      // Format categorized markdown sections
      const sections: string[] = [];

      if (rules.preferences.length > 0) {
        sections.push('## Preferences\n' + rules.preferences.map(m => {
          const val = typeof m.value === 'object' ? (m.value.content || m.value.value || JSON.stringify(m.value)) : m.value;
          // Only show key prefix if it's a meaningful name (not auto-generated)
          const key = m.preference_key || m.key || '';
          const isAutoKey = key.startsWith('memory_') || key.startsWith('auto_') || key.startsWith('pref_');
          return isAutoKey ? `- ${val}` : `- ${key}: ${val}`;
        }).join('\n'));
      }

      if (rules.corrections.length > 0) {
        sections.push('## Corrections\n' + rules.corrections.map(m => {
          const val = typeof m.value === 'object' ? (m.value.content || m.value.value || JSON.stringify(m.value)) : m.value;
          return `- ${val}`;
        }).join('\n'));
      }

      if (rules.failures.length > 0) {
        sections.push('## Failures\n' + rules.failures.map(m => {
          const val = typeof m.value === 'object' ? (m.value.content || m.value.value || JSON.stringify(m.value)) : m.value;
          return `- ${val}`;
        }).join('\n'));
      }

      if (rules.devops.length > 0) {
        sections.push('## DevOps Rules\n' + rules.devops.map(m => {
          const val = typeof m.value === 'object' ? (m.value.content || m.value.value || JSON.stringify(m.value)) : m.value;
          return `- ${val}`;
        }).join('\n'));
      }

      const totalRules = rules.preferences.length + rules.corrections.length +
        rules.failures.length + rules.devops.length;

      const resultTokens = this.estimateTokens([
        ...rules.preferences, ...rules.corrections,
        ...rules.failures, ...rules.devops
      ]);

      // Record to SearchMonitor so monitoring/stats still work
      this.searchMonitor.recordSearch(
        'load_rules',
        totalRules,
        context.sessionId,
        'mcp',
        { tool: 'load_rules', tokenMetrics: { resultTokens, tokensSaved: totalRules > 0 ? totalRules * 200 : 0 } }
      );

      let rulesText: string;
      if (sections.length > 0) {
        const body = sections.join('\n\n');
        rulesText = directive
          ? `${directive}\n\n---\n\n${body}`
          : body;
      } else {
        rulesText = 'No active rules found. This may be a new project.';
      }

      return {
        rules: rulesText,
        counts: {
          preferences: rules.preferences.length,
          corrections: rules.corrections.length,
          failures: rules.failures.length,
          devops: rules.devops.length,
          total: totalRules
        },
        summary: rules.summary,
      };
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to load rules', error);
      throw error;
    }
  }

  /**
   * Search memories by keyword query
   */
  private async handleSearchMemory(input: any, context: MCPContext): Promise<any> {
    try {
      const { query, limit: rawLimit, type, projectId } = input;

      if (!query || typeof query !== 'string') {
        throw new Error('Query is required and must be a string');
      }

      const limit = Math.min(Math.max(rawLimit || 10, 1), 25);

      const searchContext: any = {
        query,
        projectId: projectId || context.projectId,
        timestamp: Date.now()
      };
      if (type) {
        searchContext.type = type;
      }

      const results = this.memoryService.findRelevant(searchContext);
      const topResults = results.slice(0, limit);

      // Record to SearchMonitor
      this.searchMonitor.recordSearch(
        query,
        topResults.length,
        context.sessionId,
        'mcp',
        { tool: 'search_memory', type: type || 'all' }
      );

      const formatted = topResults.map(r => {
        const val = typeof r.value === 'object'
          ? (r.value.content || r.value.value || JSON.stringify(r.value))
          : r.value;
        return `- [${r.type}] (id: ${r.key}) ${val}`;
      });

      return {
        results: formatted.length > 0
          ? formatted.join('\n')
          : `No memories found matching "${query}".`,
        count: topResults.length,
        totalMatches: results.length,
        query
      };
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to search memory', error);
      throw error;
    }
  }

  /**
   * Delete a memory by ID
   */
  private async handleDeleteMemory(input: any, context: MCPContext): Promise<any> {
    try {
      const { id } = input;

      if (!id || typeof id !== 'string') {
        throw new Error('Memory ID is required and must be a string');
      }

      const deleted = this.memoryService.delete(id);

      if (deleted) {
        this.logger.info('MemoryTools', 'Memory deleted', {
          id,
          sessionId: context.sessionId
        });

        return {
          success: true,
          id,
          message: `Memory "${id}" deleted.`
        };
      } else {
        return {
          success: false,
          id,
          message: `Memory "${id}" not found.`
        };
      }
    } catch (error) {
      this.logger.error('MemoryTools', 'Failed to delete memory', error);
      throw error;
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }
}