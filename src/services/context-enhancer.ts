/**
 * Context Enhancer Service
 * Phase 3A: Dynamic tool description enhancement with relevant memories
 *
 * This service:
 * 1. Fetches relevant memories for specific tools
 * 2. Enhances tool descriptions with memory context
 * 3. Filters memories by relevance threshold
 * 4. Formats memories for easy reading
 */

import { LoggingService } from './logging';
import { MemoryService } from './memory';
import { MemoryStorage, Memory } from '../memory/storage';

export interface ToolMemoryMapping {
  toolPattern: RegExp;
  memoryTypes: string[];
  keywords: string[];
}

export class ContextEnhancer {
  private static instance: ContextEnhancer;
  private logger: LoggingService;
  private memoryService: MemoryService;
  private memoryStorage: MemoryStorage;

  // Map tool names/patterns to relevant memory types
  private readonly TOOL_MEMORY_MAPPINGS: ToolMemoryMapping[] = [
    {
      toolPattern: /file|create|write|edit/i,
      memoryTypes: ['preference'],
      keywords: ['language', 'typescript', 'javascript', 'style', 'format', 'indentation']
    },
    {
      toolPattern: /test|spec/i,
      memoryTypes: ['preference'],
      keywords: ['test', 'testing', 'jest', 'framework', 'location']
    },
    {
      toolPattern: /git|commit|push/i,
      memoryTypes: ['preference'],
      keywords: ['git', 'commit', 'workflow', 'branch']
    },
    {
      toolPattern: /database|db|sql/i,
      memoryTypes: ['project-knowledge', 'preference'],
      keywords: ['database', 'connection', 'orm', 'schema']
    },
    {
      toolPattern: /api|http|fetch/i,
      memoryTypes: ['project-knowledge', 'preference'],
      keywords: ['api', 'endpoint', 'http', 'rest', 'graphql']
    }
  ];

  private constructor() {
    this.logger = LoggingService.getInstance();
    this.memoryService = MemoryService.getInstance();
    this.memoryStorage = (this.memoryService as any).storage;
  }

  static getInstance(): ContextEnhancer {
    if (!ContextEnhancer.instance) {
      ContextEnhancer.instance = new ContextEnhancer();
    }
    return ContextEnhancer.instance;
  }

  /**
   * Get relevant memories for a specific tool
   * Filters by relevance threshold and limits to top 3
   */
  async getRelevantMemories(toolName: string, sessionId?: string): Promise<Memory[]> {
    try {
      // Find matching tool mapping
      const mapping = this.TOOL_MEMORY_MAPPINGS.find(m => m.toolPattern.test(toolName));

      if (!mapping) {
        // No specific mapping, return general preferences
        return this.getGeneralPreferences();
      }

      // Search by keywords
      const searchQuery = mapping.keywords.join(' ');
      const results = this.memoryService.search(searchQuery);

      // Filter by memory types and confidence
      const relevantMemories = results
        .filter(m => mapping.memoryTypes.includes(m.type || ''))
        .filter(m => this.getConfidence(m) >= 0.7) // Relevance threshold
        .slice(0, 3); // Limit to top 3

      this.logger.debug('ContextEnhancer', 'Got relevant memories for tool', {
        toolName,
        mapping: mapping.toolPattern.source,
        foundCount: relevantMemories.length
      });

      return relevantMemories;

    } catch (error) {
      this.logger.error('ContextEnhancer', 'Failed to get relevant memories', error);
      return [];
    }
  }

  /**
   * Get general high-confidence preferences
   */
  private getGeneralPreferences(): Memory[] {
    try {
      const allPreferences = this.memoryStorage.searchByContext({ type: 'preference' });

      return allPreferences
        .filter(m => this.getConfidence(m) >= 0.8) // Higher threshold for general prefs
        .sort((a, b) => this.getConfidence(b) - this.getConfidence(a))
        .slice(0, 3);

    } catch (error) {
      this.logger.error('ContextEnhancer', 'Failed to get general preferences', error);
      return [];
    }
  }

  /**
   * Extract confidence score from memory value
   */
  private getConfidence(memory: Memory): number {
    if (typeof memory.value === 'object' && memory.value !== null) {
      return (memory.value as any).confidence || 0.5;
    }
    return 0.5;
  }

  /**
   * Enhance tool description with memory context
   * Returns original description if no relevant memories
   */
  enhanceDescription(originalDescription: string, memories: Memory[]): string {
    if (memories.length === 0) {
      return originalDescription;
    }

    const memoryContext = this.formatMemoriesForToolDescription(memories);

    return `${originalDescription}\n\n${memoryContext}`;
  }

  /**
   * Format memories as a concise, readable context block
   */
  private formatMemoriesForToolDescription(memories: Memory[]): string {
    const lines: string[] = ['📝 Remember:'];

    for (const memory of memories) {
      const formatted = this.formatSingleMemory(memory);
      if (formatted) {
        lines.push(`- ${formatted}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format a single memory into a concise string
   */
  private formatSingleMemory(memory: Memory): string | null {
    try {
      const value = memory.value;

      // Handle different value formats
      if (typeof value === 'string') {
        return value;
      }

      if (typeof value === 'object' && value !== null) {
        // Prefer specific fields
        if ((value as any).preference) {
          return (value as any).preference;
        }
        if ((value as any).value) {
          const val = (value as any).value;
          if (typeof val === 'string') {
            return val;
          }
          if (typeof val === 'object' && (val as any).framework) {
            return `Use ${(val as any).framework}`;
          }
        }
        if ((value as any).message) {
          return (value as any).message;
        }
        if ((value as any).content) {
          return (value as any).content;
        }

        // Fallback: extract key info
        return this.extractKeyInfo(memory.key, value);
      }

      return null;

    } catch (error) {
      this.logger.error('ContextEnhancer', 'Failed to format memory', error);
      return null;
    }
  }

  /**
   * Extract key information from memory key and value
   */
  private extractKeyInfo(key: string, value: any): string {
    // Extract from key
    const cleanKey = key
      .replace(/pref_/g, '')
      .replace(/_\d+$/g, '') // Remove timestamps
      .replace(/_/g, ' ');

    // Try to get value from object
    if (value.framework) return `${cleanKey}: ${value.framework}`;
    if (value.location) return `${cleanKey}: ${value.location}`;
    if (value.style) return `${cleanKey}: ${value.style}`;

    return cleanKey;
  }

  /**
   * Get enhanced tool descriptions for all tools
   * Used by MCP server to enrich tools/list response
   */
  async enhanceToolsList(
    tools: Array<{ name: string; description: string; inputSchema: any }>,
    sessionId?: string
  ): Promise<Array<{ name: string; description: string; inputSchema: any }>> {
    const enhanced = await Promise.all(
      tools.map(async (tool) => {
        const memories = await this.getRelevantMemories(tool.name, sessionId);
        const enhancedDesc = this.enhanceDescription(tool.description, memories);

        return {
          ...tool,
          description: enhancedDesc
        };
      })
    );

    this.logger.info('ContextEnhancer', 'Enhanced tools list', {
      totalTools: tools.length,
      enhancedTools: enhanced.filter(t => t.description !== tools.find(orig => orig.name === t.name)?.description).length
    });

    return enhanced;
  }
}
