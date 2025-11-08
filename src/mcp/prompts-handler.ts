import { MemoryService } from '../services/memory';
import { MemoryStorage } from '../memory/storage';
import { LoggingService } from '../services/logging';
import { MCPRequest, MCPResponse } from './server';

export interface MCPPrompt {
  name: string;
  description: string;
  arguments?: Array<{
    name: string;
    description: string;
    required?: boolean;
  }>;
}

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GetPromptResult {
  description?: string;
  messages: PromptMessage[];
}

/**
 * Handles MCP Prompts protocol
 * Prompts are reusable templates with memory context automatically injected
 * Claude Code can invoke these to get context-enriched prompts
 */
export class PromptsHandler {
  private logger: LoggingService;
  private memoryService: MemoryService;
  private memoryStorage: MemoryStorage;

  constructor() {
    this.logger = LoggingService.getInstance();
    this.memoryService = MemoryService.getInstance();
    this.memoryStorage = (this.memoryService as any).storage;
  }

  /**
   * Handle prompts/list request
   * Returns list of available prompt templates
   */
  async handlePromptsList(request: MCPRequest): Promise<MCPResponse> {
    try {
      const prompts: MCPPrompt[] = [
        {
          name: 'with-preferences',
          description: 'Inject user coding preferences into the conversation context',
          arguments: []
        },
        {
          name: 'with-project-context',
          description: 'Inject relevant project knowledge (database configs, API patterns, etc.)',
          arguments: [
            {
              name: 'topic',
              description: 'Specific topic to focus on (e.g., "database", "api", "testing")',
              required: false
            }
          ]
        },
        {
          name: 'with-corrections',
          description: 'Inject recent correction patterns to avoid repeating mistakes',
          arguments: []
        },
        {
          name: 'with-full-context',
          description: 'Inject all relevant memories (preferences + project knowledge + corrections)',
          arguments: [
            {
              name: 'task',
              description: 'The task you want to perform',
              required: true
            }
          ]
        },
        {
          name: 'analyze-for-preferences',
          description: 'Analyze conversation to extract and store new preferences',
          arguments: [
            {
              name: 'conversation',
              description: 'Recent conversation text to analyze',
              required: true
            }
          ]
        }
      ];

      this.logger.info('PromptsHandler', 'Listed prompts', {
        count: prompts.length
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          prompts
        }
      };
    } catch (error) {
      this.logger.error('PromptsHandler', 'Failed to list prompts', error);
      return this.createErrorResponse(request.id, -32603, 'Failed to list prompts');
    }
  }

  /**
   * Handle prompts/get request
   * Returns a specific prompt with memory context injected
   */
  async handlePromptsGet(request: MCPRequest): Promise<MCPResponse> {
    try {
      const { name, arguments: args } = request.params || {};

      if (!name || typeof name !== 'string') {
        return this.createErrorResponse(request.id, -32602, 'Missing or invalid name parameter');
      }

      let promptResult: GetPromptResult;

      switch (name) {
        case 'with-preferences':
          promptResult = await this.getPreferencesPrompt();
          break;

        case 'with-project-context':
          promptResult = await this.getProjectContextPrompt(args?.topic);
          break;

        case 'with-corrections':
          promptResult = await this.getCorrectionsPrompt();
          break;

        case 'with-full-context':
          promptResult = await this.getFullContextPrompt(args?.task);
          break;

        case 'analyze-for-preferences':
          promptResult = await this.getAnalyzePreferencesPrompt(args?.conversation);
          break;

        default:
          return this.createErrorResponse(request.id, -32602, `Unknown prompt: ${name}`);
      }

      this.logger.info('PromptsHandler', 'Generated prompt', {
        name,
        messageCount: promptResult.messages.length
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: promptResult
      };
    } catch (error) {
      this.logger.error('PromptsHandler', 'Failed to get prompt', error);
      return this.createErrorResponse(request.id, -32603, 'Failed to get prompt');
    }
  }

  /**
   * Get preferences prompt
   * Injects all user preferences into context
   */
  private async getPreferencesPrompt(): Promise<GetPromptResult> {
    const preferences = this.memoryStorage.searchByContext({ type: 'preference' });

    const preferencesText = this.formatPreferencesForPrompt(preferences);

    return {
      description: 'User coding preferences automatically injected',
      messages: [
        {
          role: 'system',
          content: `# User Coding Preferences

${preferencesText}

Apply these preferences when generating code or making suggestions.`
        }
      ]
    };
  }

  /**
   * Get project context prompt
   * Injects relevant project knowledge
   */
  private async getProjectContextPrompt(topic?: string): Promise<GetPromptResult> {
    let knowledge = this.memoryStorage.searchByContext({ type: 'project-knowledge' });

    // Filter by topic if provided
    if (topic) {
      const results = this.memoryService.search(topic);
      const knowledgeKeys = new Set(results.map(r => r.key));
      knowledge = knowledge.filter(k => knowledgeKeys.has(k.key));
    }

    const contextText = this.formatKnowledgeForPrompt(knowledge);

    return {
      description: topic
        ? `Project knowledge about ${topic}`
        : 'All project knowledge',
      messages: [
        {
          role: 'system',
          content: `# Project Knowledge

${contextText}

Use this information when working with the project.`
        }
      ]
    };
  }

  /**
   * Get corrections prompt
   * Injects recent correction patterns
   */
  private async getCorrectionsPrompt(): Promise<GetPromptResult> {
    const corrections = this.memoryStorage.searchByContext({ type: 'correction' });

    // Get most recent 10
    const recentCorrections = corrections
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 10);

    const correctionsText = this.formatCorrectionsForPrompt(recentCorrections);

    return {
      description: 'Recent correction patterns to avoid mistakes',
      messages: [
        {
          role: 'system',
          content: `# Correction Patterns

${correctionsText}

Avoid these patterns when generating code.`
        }
      ]
    };
  }

  /**
   * Get full context prompt
   * Injects all relevant memories for a specific task
   */
  private async getFullContextPrompt(task?: string): Promise<GetPromptResult> {
    if (!task) {
      return this.createErrorPrompt('Task parameter is required');
    }

    // Search for relevant memories based on task
    const searchResults = this.memoryService.search(task);

    // Get top 10 most relevant
    const relevantMemories = searchResults.slice(0, 10);

    const contextText = this.formatMemoriesForPrompt(relevantMemories);

    return {
      description: `Full context for: ${task}`,
      messages: [
        {
          role: 'system',
          content: `# Relevant Context

${contextText}

Use this context when working on: ${task}`
        }
      ]
    };
  }

  /**
   * Get analyze preferences prompt
   * This is a special prompt that asks Claude to analyze conversation
   * and extract preferences to store
   */
  private async getAnalyzePreferencesPrompt(conversation?: string): Promise<GetPromptResult> {
    if (!conversation) {
      return this.createErrorPrompt('Conversation parameter is required');
    }

    return {
      description: 'Analyze conversation for preference extraction',
      messages: [
        {
          role: 'system',
          content: `You are analyzing a conversation to extract user coding preferences.

Extract any preferences about:
- Programming languages and frameworks
- Code style (indentation, quotes, semicolons, etc.)
- File organization and naming
- Testing approaches
- Tool choices
- Workflow patterns
- Team conventions

Return a JSON array with format:
[
  {
    "key": "descriptive_key",
    "value": "the preference value",
    "confidence": 0.0-1.0,
    "reasoning": "why this is a preference"
  }
]

Be conservative - only extract clear, explicit preferences.`
        },
        {
          role: 'user',
          content: `Analyze this conversation for preferences:\n\n${conversation}`
        }
      ]
    };
  }

  /**
   * Format preferences for prompt injection
   */
  private formatPreferencesForPrompt(preferences: any[]): string {
    if (preferences.length === 0) {
      return '_No preferences stored yet._';
    }

    let text = '';

    // Group by category
    const grouped = this.groupByCategory(preferences);

    for (const [category, prefs] of grouped.entries()) {
      text += `## ${category}\n\n`;

      for (const pref of prefs) {
        const value = typeof pref.value === 'object'
          ? JSON.stringify(pref.value)
          : pref.value;

        text += `- **${pref.key}**: ${value}\n`;
      }

      text += '\n';
    }

    return text;
  }

  /**
   * Format knowledge for prompt injection
   */
  private formatKnowledgeForPrompt(knowledge: any[]): string {
    if (knowledge.length === 0) {
      return '_No project knowledge stored yet._';
    }

    let text = '';

    for (const item of knowledge) {
      text += `### ${item.key}\n\n`;

      if (typeof item.value === 'object') {
        text += '```json\n';
        text += JSON.stringify(item.value, null, 2);
        text += '\n```\n\n';
      } else {
        text += `${item.value}\n\n`;
      }
    }

    return text;
  }

  /**
   * Format corrections for prompt injection
   */
  private formatCorrectionsForPrompt(corrections: any[]): string {
    if (corrections.length === 0) {
      return '_No correction patterns yet._';
    }

    let text = '';

    for (const correction of corrections) {
      const pattern = typeof correction.value === 'object'
        ? correction.value
        : { description: correction.value };

      if (pattern.original && pattern.corrected) {
        text += `- ❌ Avoid: \`${pattern.original}\`\n`;
        text += `  ✓ Use instead: \`${pattern.corrected}\`\n\n`;
      } else {
        text += `- ${pattern.description || JSON.stringify(pattern)}\n\n`;
      }
    }

    return text;
  }

  /**
   * Format general memories for prompt injection
   */
  private formatMemoriesForPrompt(memories: any[]): string {
    if (memories.length === 0) {
      return '_No relevant memories found._';
    }

    let text = '';

    for (const memory of memories) {
      text += `### ${memory.type}: ${memory.key}\n\n`;

      const value = typeof memory.value === 'object'
        ? JSON.stringify(memory.value, null, 2)
        : memory.value;

      text += `${value}\n\n`;

      if (memory.score) {
        text += `_Relevance: ${(memory.score * 100).toFixed(0)}%_\n\n`;
      }
    }

    return text;
  }

  /**
   * Group memories by category
   */
  private groupByCategory(memories: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const memory of memories) {
      const category = this.categorizeMemory(memory.key);
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(memory);
    }

    return groups;
  }

  /**
   * Categorize memory by key
   */
  private categorizeMemory(key: string): string {
    if (key.includes('test') || key.includes('spec')) return 'Testing';
    if (key.includes('indent') || key.includes('format') || key.includes('style')) return 'Code Style';
    if (key.includes('framework') || key.includes('library')) return 'Frameworks';
    if (key.includes('file') || key.includes('directory')) return 'File Organization';
    if (key.includes('git') || key.includes('commit')) return 'Version Control';
    if (key.includes('database') || key.includes('db')) return 'Database';
    if (key.includes('api') || key.includes('endpoint')) return 'API';
    return 'General';
  }

  /**
   * Create error prompt result
   */
  private createErrorPrompt(message: string): GetPromptResult {
    return {
      description: 'Error',
      messages: [
        {
          role: 'system',
          content: `Error: ${message}`
        }
      ]
    };
  }

  /**
   * Create error response
   */
  private createErrorResponse(id: string | number, code: number, message: string): MCPResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    };
  }
}
