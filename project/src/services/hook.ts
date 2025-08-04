import { MemoryService, MemoryServiceContext } from './memory';
import { MemoryEnhancer } from './memory-enhancer';
import { ConfigService } from './config';
import { LoggingService } from './logging';

export interface HookEvent {
  type: string;
  tool_name?: string;
  tool_input?: any;
  content?: string;
  timestamp: number;
  session_id: string;
}

export interface PreferenceExtraction {
  pattern: string;
  subject: string;
  action: string;
  object?: string;
  raw: string;
}

export class HookService {
  private static instance: HookService;
  private memoryService = MemoryService.getInstance();
  private config = ConfigService.getInstance();
  private logger = LoggingService.getInstance();
  
  // Preference pattern regexes
  private readonly PREFERENCE_PATTERNS = [
    /(\w+(?:\s+\w+)*)\s+should\s+be\s+(\w+(?:\s+\w+)*)/gi,
    /use\s+(\w+(?:\s+\w+)*)\s+for\s+(\w+(?:\s+\w+)*)/gi,
    /save\s+(\w+(?:\s+\w+)*)\s+in\s+(\w+(?:\s+\w+)*)/gi,
    /put\s+(\w+(?:\s+\w+)*)\s+in\s+(\w+(?:\s+\w+)*)/gi,
    /store\s+(\w+(?:\s+\w+)*)\s+in\s+(\w+(?:\s+\w+)*)/gi,
    /(\w+(?:\s+\w+)*)\s+goes?\s+in\s+(\w+(?:\s+\w+)*)/gi,
    /prefer\s+(\w+(?:\s+\w+)*)\s+over\s+(\w+(?:\s+\w+)*)/gi,
    /always\s+(\w+(?:\s+\w+)*)/gi,
    /never\s+(\w+(?:\s+\w+)*)/gi,
    /(tests?|files?|code|components?|modules?)\s+(?:should\s+)?(?:be\s+)?(?:saved?|stored?|placed?|go)\s+(?:in|to|at)\s+([\w\-\/]+)/gi
  ];
  
  private constructor() {
    this.logger.info('HookService', 'Initialized hook service');
  }
  
  static getInstance(): HookService {
    if (!HookService.instance) {
      HookService.instance = new HookService();
    }
    return HookService.instance;
  }
  
  /**
   * Process pre-tool hook events
   */
  async handlePreTool(event: HookEvent): Promise<{ additionalContext?: string; memories?: number }> {
    try {
      this.logger.logHookEvent('PreTool', event.tool_name || 'Unknown', {
        toolInput: event.tool_input,
        sessionId: event.session_id
      });
      
      // Extract query from tool input
      const query = this.extractQueryFromToolInput(event.tool_input);
      
      const context: MemoryServiceContext = {
        projectId: this.config.getProjectId(),
        filePath: event.tool_input?.file_path || event.tool_input?.file,
        tool: event.tool_name,
        timestamp: event.timestamp,
        query,
        sessionId: event.session_id
      };
      
      // Store the tool use event
      if (event.tool_name) {
        this.memoryService.storeToolUse(event.tool_name, event.tool_input, context);
      }
      
      // Retrieve relevant memories
      const memories = this.memoryService.findRelevant(context);
      
      if (memories.length > 0) {
        const formattedMemories = this.formatMemories(memories);
        return {
          additionalContext: formattedMemories,
          memories: memories.length
        };
      }
      
      return {};
      
    } catch (error) {
      this.logger.logServiceError('HookService', 'handlePreTool', error as Error, {
        eventType: event.type,
        toolName: event.tool_name
      });
      return {};
    }
  }
  
  /**
   * Process user prompt submit events
   */
  async handleUserPromptSubmit(event: HookEvent): Promise<{ additionalContext?: string; memories?: number; preferences?: number }> {
    try {
      this.logger.logHookEvent('UserPromptSubmit', 'prompt', {
        contentLength: event.content?.length,
        sessionId: event.session_id
      });
      
      const content = event.content || '';
      const context: MemoryServiceContext = {
        projectId: this.config.getProjectId(),
        query: content,
        timestamp: event.timestamp,
        sessionId: event.session_id
      };
      
      // Extract and store preferences
      const preferences = this.extractPreferences(content);
      for (const preference of preferences) {
        this.memoryService.storePreference(preference, context);
      }
      
      // Store substantial prompts as project knowledge
      if (content.length > 50) {
        this.memoryService.storeProjectKnowledge({
          content,
          type: 'user_instruction'
        }, context);
      }
      
      // Retrieve relevant memories
      const enhancer = new MemoryEnhancer();
      const memories = await enhancer.enhanceSearch(content);
      
      if (memories.length > 0) {
        const formattedMemories = this.formatRetrievedMemories(memories);
        return {
          additionalContext: formattedMemories,
          memories: memories.length,
          preferences: preferences.length
        };
      }
      
      return { preferences: preferences.length };
      
    } catch (error) {
      this.logger.logServiceError('HookService', 'handleUserPromptSubmit', error as Error, {
        eventType: event.type,
        contentLength: event.content?.length
      });
      return {};
    }
  }
  
  /**
   * Process post-tool hook events
   */
  async handlePostTool(event: HookEvent): Promise<void> {
    try {
      this.logger.logHookEvent('PostTool', event.tool_name || 'Unknown', {
        sessionId: event.session_id
      });
      
      // This can be extended for pattern detection and correction storage
      // For now, just log the event
      
    } catch (error) {
      this.logger.logServiceError('HookService', 'handlePostTool', error as Error, {
        eventType: event.type,
        toolName: event.tool_name
      });
    }
  }
  
  private extractQueryFromToolInput(toolInput: any): string {
    if (!toolInput) return '';
    
    const query = toolInput.query || 
                  toolInput.prompt || 
                  toolInput.question || 
                  toolInput.content || 
                  toolInput.message || 
                  toolInput.input || 
                  '';
    
    return typeof query === 'object' ? JSON.stringify(query) : String(query);
  }
  
  private extractPreferences(content: string): PreferenceExtraction[] {
    const preferences: PreferenceExtraction[] = [];
    
    for (const pattern of this.PREFERENCE_PATTERNS) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      
      while ((match = regex.exec(content)) !== null) {
        const raw = match[0];
        
        if (raw.includes('should be')) {
          preferences.push({
            pattern: 'should_be',
            subject: match[1].trim(),
            action: 'should be',
            object: match[2].trim(),
            raw
          });
        } else if (raw.includes('use') && raw.includes('for')) {
          preferences.push({
            pattern: 'use_for',
            subject: match[1].trim(),
            action: 'use for',
            object: match[2].trim(),
            raw
          });
        } else if (raw.includes('save') || raw.includes('store') || raw.includes('put')) {
          preferences.push({
            pattern: 'location',
            subject: match[1].trim(),
            action: 'save in',
            object: match[2].trim(),
            raw
          });
        } else if (raw.includes('goes in')) {
          preferences.push({
            pattern: 'location',
            subject: match[1].trim(),
            action: 'goes in',
            object: match[2].trim(),
            raw
          });
        } else if (raw.includes('prefer')) {
          preferences.push({
            pattern: 'preference',
            subject: match[1].trim(),
            action: 'prefer over',
            object: match[2].trim(),
            raw
          });
        } else if (raw.includes('always')) {
          preferences.push({
            pattern: 'always',
            subject: match[1].trim(),
            action: 'always',
            raw
          });
        } else if (raw.includes('never')) {
          preferences.push({
            pattern: 'never',
            subject: match[1].trim(),
            action: 'never',
            raw
          });
        }
      }
    }
    
    return preferences;
  }
  
  private formatMemories(memories: any[]): string {
    if (memories.length === 0) return '';
    
    let formatted = '🧠 Relevant memories from previous sessions:\n';
    
    memories.forEach((memory, index) => {
      formatted += `\n${index + 1}. `;
      
      if (memory.type === 'correction-pattern') {
        formatted += `Pattern: ${memory.value.original} → ${memory.value.corrected}`;
        if (memory.value.frequency > 1) {
          formatted += ` (used ${memory.value.frequency} times)`;
        }
      } else if (memory.type === 'preference') {
        formatted += `Preference: ${memory.value.description || memory.value}`;
      } else {
        formatted += `${memory.type}: ${JSON.stringify(memory.value).substring(0, 100)}...`;
      }
      
      if (memory.file_path) {
        formatted += `\n   File: ${memory.file_path}`;
      }
      if (memory.project_id) {
        formatted += `\n   Project: ${memory.project_id}`;
      }
    });
    
    return formatted;
  }
  
  private formatRetrievedMemories(memories: any[]): string {
    if (memories.length === 0) return '';
    
    let formatted = '🧠 Relevant preferences and knowledge from previous conversations:\n';
    
    memories.forEach((memory, index) => {
      formatted += `\n${index + 1}. `;
      
      if (memory.type === 'preference') {
        const pref = memory.value;
        if (pref.object) {
          formatted += `${pref.subject} ${pref.action} ${pref.object}`;
        } else {
          formatted += `${pref.action} ${pref.subject}`;
        }
        formatted += ` (from: "${pref.raw}")`;
      } else if (memory.type === 'project-knowledge') {
        formatted += `Project knowledge: ${memory.value.description || JSON.stringify(memory.value)}`;
      } else {
        formatted += `${memory.type}: ${JSON.stringify(memory.value).substring(0, 100)}...`;
      }
      
      if (memory.timestamp) {
        const date = new Date(memory.timestamp);
        formatted += `\n   Captured: ${date.toLocaleString()}`;
      }
    });
    
    return formatted;
  }
}