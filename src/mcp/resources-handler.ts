import { MemoryService } from '../services/memory';
import { MemoryStorage } from '../memory/storage';
import { LoggingService } from '../services/logging';
import { MCPRequest, MCPResponse } from './server';

export interface MCPResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  metadata?: {
    size?: number;
    lastUpdated?: string;
    category?: string;
  };
}

export interface ResourceContent {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

/**
 * Handles MCP Resources protocol
 * Resources are static/semi-static context that Claude Code can subscribe to
 * and automatically inject into conversations
 */
export class ResourcesHandler {
  private logger: LoggingService;
  private memoryService: MemoryService;
  private memoryStorage: MemoryStorage;

  constructor() {
    this.logger = LoggingService.getInstance();
    this.memoryService = MemoryService.getInstance();
    this.memoryStorage = (this.memoryService as any).storage;
  }

  /**
   * Handle resources/list request
   * Returns list of available resources Claude Code can subscribe to
   */
  async handleResourcesList(request: MCPRequest): Promise<MCPResponse> {
    try {
      const stats = this.memoryService.getStats();
      const resources: MCPResource[] = [];

      // Resource: All preferences
      if (stats.byType.preference > 0) {
        resources.push({
          uri: 'claude-recall://preferences/all',
          name: 'User Preferences',
          description: 'All stored coding preferences, tool choices, and workflow patterns',
          mimeType: 'application/json',
          metadata: {
            size: stats.byType.preference,
            category: 'preferences',
            lastUpdated: new Date().toISOString()
          }
        });
      }

      // Resource: Project knowledge
      if (stats.byType['project-knowledge'] > 0) {
        resources.push({
          uri: 'claude-recall://project/knowledge',
          name: 'Project Knowledge',
          description: 'Database configs, API patterns, architecture decisions, dependencies',
          mimeType: 'application/json',
          metadata: {
            size: stats.byType['project-knowledge'],
            category: 'knowledge',
            lastUpdated: new Date().toISOString()
          }
        });
      }

      // Resource: Recent corrections
      if (stats.byType.correction > 0) {
        resources.push({
          uri: 'claude-recall://corrections/recent',
          name: 'Recent Corrections',
          description: 'Patterns learned from corrections and mistakes to avoid',
          mimeType: 'application/json',
          metadata: {
            size: Math.min(stats.byType.correction, 10),
            category: 'corrections',
            lastUpdated: new Date().toISOString()
          }
        });
      }

      // Resource: Active context (top 5 most relevant)
      resources.push({
        uri: 'claude-recall://context/active',
        name: 'Active Context',
        description: 'Most relevant memories for current work session',
        mimeType: 'application/json',
        metadata: {
          size: 5,
          category: 'context',
          lastUpdated: new Date().toISOString()
        }
      });

      this.logger.info('ResourcesHandler', 'Listed resources', {
        count: resources.length,
        categories: resources.map(r => r.metadata?.category)
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          resources
        }
      };
    } catch (error) {
      this.logger.error('ResourcesHandler', 'Failed to list resources', error);
      return this.createErrorResponse(request.id, -32603, 'Failed to list resources');
    }
  }

  /**
   * Handle resources/read request
   * Returns content of a specific resource
   */
  async handleResourcesRead(request: MCPRequest): Promise<MCPResponse> {
    try {
      const { uri } = request.params || {};

      if (!uri || typeof uri !== 'string') {
        return this.createErrorResponse(request.id, -32602, 'Missing or invalid uri parameter');
      }

      let content: ResourceContent;

      switch (uri) {
        case 'claude-recall://preferences/all':
          content = await this.getPreferencesResource(uri);
          break;

        case 'claude-recall://project/knowledge':
          content = await this.getProjectKnowledgeResource(uri);
          break;

        case 'claude-recall://corrections/recent':
          content = await this.getCorrectionsResource(uri);
          break;

        case 'claude-recall://context/active':
          content = await this.getActiveContextResource(uri);
          break;

        default:
          return this.createErrorResponse(request.id, -32602, `Unknown resource URI: ${uri}`);
      }

      this.logger.info('ResourcesHandler', 'Read resource', {
        uri,
        contentLength: content.text?.length || 0
      });

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          contents: [content]
        }
      };
    } catch (error) {
      this.logger.error('ResourcesHandler', 'Failed to read resource', error);
      return this.createErrorResponse(request.id, -32603, 'Failed to read resource');
    }
  }

  /**
   * Get preferences resource content
   */
  private async getPreferencesResource(uri: string): Promise<ResourceContent> {
    const memories = this.memoryStorage.searchByContext({ type: 'preference' });

    // Format preferences for easy consumption
    const preferences = memories.map(m => ({
      key: m.key,
      value: m.value,
      timestamp: m.timestamp,
      accessCount: m.access_count,
      confidence: m.relevance_score
    }));

    // Group by category for better organization
    const grouped = this.groupPreferences(preferences);

    const text = this.formatPreferencesAsText(grouped);

    return {
      uri,
      mimeType: 'text/markdown',
      text
    };
  }

  /**
   * Get project knowledge resource content
   */
  private async getProjectKnowledgeResource(uri: string): Promise<ResourceContent> {
    const memories = this.memoryStorage.searchByContext({ type: 'project-knowledge' });

    const knowledge = memories.map(m => ({
      key: m.key,
      content: m.value,
      project: m.project_id,
      file: m.file_path,
      timestamp: m.timestamp
    }));

    const text = this.formatKnowledgeAsText(knowledge);

    return {
      uri,
      mimeType: 'text/markdown',
      text
    };
  }

  /**
   * Get recent corrections resource content
   */
  private async getCorrectionsResource(uri: string): Promise<ResourceContent> {
    const memories = this.memoryStorage.searchByContext({ type: 'correction' });

    // Get most recent 10 corrections
    const recentCorrections = memories
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
      .slice(0, 10);

    const corrections = recentCorrections.map(m => ({
      pattern: m.value,
      timestamp: m.timestamp,
      frequency: m.access_count
    }));

    const text = this.formatCorrectionsAsText(corrections);

    return {
      uri,
      mimeType: 'text/markdown',
      text
    };
  }

  /**
   * Get active context resource content
   * Returns most relevant memories for current session
   */
  private async getActiveContextResource(uri: string): Promise<ResourceContent> {
    // Get top 5 most accessed memories from last 24 hours
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    const allMemories = this.memoryStorage.searchByContext({});

    const recentMemories = allMemories
      .filter(m => (m.timestamp || 0) > oneDayAgo)
      .sort((a, b) => (b.access_count || 0) - (a.access_count || 0))
      .slice(0, 5);

    const context = recentMemories.map(m => ({
      type: m.type,
      key: m.key,
      value: m.value,
      relevance: m.relevance_score,
      accessCount: m.access_count
    }));

    const text = this.formatContextAsText(context);

    return {
      uri,
      mimeType: 'text/markdown',
      text
    };
  }

  /**
   * Group preferences by category
   */
  private groupPreferences(preferences: any[]): Map<string, any[]> {
    const groups = new Map<string, any[]>();

    for (const pref of preferences) {
      const category = this.categorizePreference(pref.key);
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(pref);
    }

    return groups;
  }

  /**
   * Categorize preference by key
   */
  private categorizePreference(key: string): string {
    if (key.includes('test') || key.includes('spec')) return 'Testing';
    if (key.includes('indent') || key.includes('format') || key.includes('style')) return 'Code Style';
    if (key.includes('framework') || key.includes('library')) return 'Frameworks';
    if (key.includes('file') || key.includes('directory')) return 'File Organization';
    if (key.includes('git') || key.includes('commit')) return 'Version Control';
    return 'General';
  }

  /**
   * Format preferences as human-readable text
   */
  private formatPreferencesAsText(grouped: Map<string, any[]>): string {
    let text = '# User Preferences\n\n';
    text += '_Automatically captured coding preferences and patterns_\n\n';

    for (const [category, prefs] of grouped.entries()) {
      text += `## ${category}\n\n`;

      for (const pref of prefs) {
        const value = typeof pref.value === 'object'
          ? JSON.stringify(pref.value, null, 2)
          : pref.value;

        text += `- **${pref.key}**: ${value}\n`;
        if (pref.confidence >= 0.9) {
          text += `  - ✓ High confidence (${(pref.confidence * 100).toFixed(0)}%)\n`;
        }
      }
      text += '\n';
    }

    return text;
  }

  /**
   * Format project knowledge as human-readable text
   */
  private formatKnowledgeAsText(knowledge: any[]): string {
    let text = '# Project Knowledge\n\n';
    text += '_Database configs, API patterns, architecture decisions_\n\n';

    // Group by project if available
    const byProject = new Map<string, any[]>();
    for (const item of knowledge) {
      const project = item.project || 'General';
      if (!byProject.has(project)) {
        byProject.set(project, []);
      }
      byProject.get(project)!.push(item);
    }

    for (const [project, items] of byProject.entries()) {
      if (project !== 'General') {
        text += `## Project: ${project}\n\n`;
      }

      for (const item of items) {
        text += `### ${item.key}\n\n`;

        if (typeof item.content === 'object') {
          text += '```json\n';
          text += JSON.stringify(item.content, null, 2);
          text += '\n```\n\n';
        } else {
          text += `${item.content}\n\n`;
        }

        if (item.file) {
          text += `_Related to: ${item.file}_\n\n`;
        }
      }
    }

    return text;
  }

  /**
   * Format corrections as human-readable text
   */
  private formatCorrectionsAsText(corrections: any[]): string {
    let text = '# Recent Corrections\n\n';
    text += '_Patterns learned from mistakes to avoid_\n\n';

    for (const correction of corrections) {
      const pattern = typeof correction.pattern === 'object'
        ? correction.pattern
        : { description: correction.pattern };

      text += `## Pattern\n\n`;

      if (pattern.original && pattern.corrected) {
        text += `- ❌ Avoid: \`${pattern.original}\`\n`;
        text += `- ✓ Use: \`${pattern.corrected}\`\n`;
      } else {
        text += `- ${pattern.description || JSON.stringify(pattern)}\n`;
      }

      if (correction.frequency > 1) {
        text += `- Observed ${correction.frequency} times\n`;
      }

      text += '\n';
    }

    return text;
  }

  /**
   * Format active context as human-readable text
   */
  private formatContextAsText(context: any[]): string {
    let text = '# Active Context\n\n';
    text += '_Most relevant memories for current session_\n\n';

    if (context.length === 0) {
      text += '_No active context yet. Memories will appear here as you work._\n';
      return text;
    }

    for (const item of context) {
      text += `## ${item.type}\n\n`;

      const value = typeof item.value === 'object'
        ? JSON.stringify(item.value, null, 2)
        : item.value;

      text += `${value}\n\n`;
      text += `_Used ${item.accessCount} times | Relevance: ${(item.relevance * 100).toFixed(0)}%_\n\n`;
    }

    return text;
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
