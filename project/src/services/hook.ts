import { MemoryService, MemoryServiceContext } from './memory';
import { MemoryEnhancer } from './memory-enhancer';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { PreferenceExtractor, ExtractedPreference } from './preference-extractor';
import { SemanticPreferenceExtractor, ExtractedSemanticPreference } from './semantic-preference-extractor';
import { IntelligentPreferenceExtractor, IntelligentPreference } from './intelligent-preference-extractor';

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
  private preferenceExtractor = new PreferenceExtractor();
  private semanticExtractor = new SemanticPreferenceExtractor();
  private intelligentExtractor?: IntelligentPreferenceExtractor;
  
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
    
    // Initialize intelligent extractor if API key is available
    if (process.env.ANTHROPIC_API_KEY) {
      this.intelligentExtractor = new IntelligentPreferenceExtractor();
      this.logger.info('HookService', 'Initialized intelligent NLP preference extractor');
    } else {
      this.logger.warn('HookService', 'ANTHROPIC_API_KEY not found, using pattern-based extraction only');
    }
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
   * Process user prompt submit events with intelligent preference extraction
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
      
      let preferencesStored = 0;
      
      // Try intelligent NLP extraction first if available
      if (this.intelligentExtractor) {
        try {
          // Prepare context for NLP analysis
          const nlpContext = {
            recentMemories: this.memoryService.findRelevant(context).slice(0, 10),
            projectContext: { projectId: context.projectId },
            sessionHistory: context.sessionId ? [context.sessionId] : []
          };
          
          const intelligentPreferences = await this.intelligentExtractor.extractPreferences(content, nlpContext);
          
          for (const nlpPref of intelligentPreferences) {
            // Convert to ExtractedPreference format
            const preference: ExtractedPreference = {
              key: nlpPref.key,
              value: nlpPref.value,
              confidence: nlpPref.confidence,
              raw: nlpPref.rawText,
              isOverride: nlpPref.analysis.preference?.isOverride || false,
              overrideSignals: nlpPref.analysis.preference?.isOverride ? ['NLP-detected override'] : []
            };
            
            this.memoryService.storePreferenceWithOverride(preference, context);
            preferencesStored++;
            
            this.logger.info('HookService', `Stored NLP-extracted preference: ${preference.key} = ${preference.value}`, {
              confidence: preference.confidence,
              isOverride: preference.isOverride,
              reasoning: nlpPref.analysis.reasoning,
              source: nlpPref.metadata.source
            });
          }
        } catch (nlpError) {
          this.logger.warn('HookService', 'NLP extraction failed, falling back to pattern matching', nlpError as Error);
        }
      }
      
      // Extract preferences using semantic understanding  
      const semanticPreferences = this.semanticExtractor.extractAllPreferences(content);
      
      // If no NLP preferences found or NLP not available, use semantic pattern extraction
      if (preferencesStored === 0) {
        // Store semantic preferences with override handling
        for (const semanticPref of semanticPreferences) {
          // Convert to ExtractedPreference format
          const preference: ExtractedPreference = {
            key: semanticPref.key,
            value: semanticPref.value,
            confidence: semanticPref.confidence,
            raw: semanticPref.rawText,
            isOverride: semanticPref.isOverride,
            overrideSignals: semanticPref.overrideSignals
          };
          
          this.memoryService.storePreferenceWithOverride(preference, context);
          preferencesStored++;
          
          this.logger.info('HookService', `Stored semantic preference: ${preference.key} = ${preference.value}`, {
            intent: semanticPref.intent,
            confidence: preference.confidence,
            isOverride: preference.isOverride
          });
        }
      }
      
      // Also try the pattern-based extractor for additional coverage
      const patternPreferences = this.preferenceExtractor.extractPreferences(content);
      for (const patternPref of patternPreferences) {
        // Only store if not already captured by semantic extraction
        const alreadyCaptured = semanticPreferences.some((sp: ExtractedSemanticPreference) => 
          sp.rawText.toLowerCase().includes(patternPref.raw.toLowerCase()) ||
          (sp.key === patternPref.key && sp.value === patternPref.value)
        );
        
        if (!alreadyCaptured) {
          this.memoryService.storePreferenceWithOverride(patternPref, context);
          preferencesStored++;
          
          this.logger.debug('HookService', `Stored pattern-based preference: ${patternPref.key} = ${patternPref.value}`, {
            confidence: patternPref.confidence
          });
        }
      }
      
      // Fallback to legacy extraction for compatibility
      const legacyPreferences = this.extractPreferences(content);
      for (const legacyPref of legacyPreferences) {
        // Only store if not already captured by semantic or pattern extraction
        const alreadyCaptured = [...semanticPreferences, ...patternPreferences].some((p: any) => {
          const rawText = 'rawText' in p ? p.rawText : p.raw;
          return rawText.toLowerCase().includes(legacyPref.raw.toLowerCase()) ||
                 legacyPref.raw.toLowerCase().includes(rawText.toLowerCase());
        });
        
        if (!alreadyCaptured) {
          this.memoryService.storePreference(legacyPref, context);
          preferencesStored++;
          
          this.logger.debug('HookService', `Stored legacy preference: ${legacyPref.pattern}`, {
            subject: legacyPref.subject,
            action: legacyPref.action,
            object: legacyPref.object
          });
        }
      }
      
      // Store substantial prompts as project knowledge
      if (content.length > 50) {
        this.memoryService.storeProjectKnowledge({
          content,
          type: 'user_instruction'
        }, context);
      }
      
      // Retrieve relevant memories with enhanced active preference retrieval
      const enhancer = new MemoryEnhancer();
      const memories = await enhancer.enhanceSearch(content);
      
      // Prepare for Claude NLP analysis if this might contain a preference
      let additionalContext = '';
      
      if (memories.length > 0) {
        additionalContext = this.formatRetrievedMemoriesWithActivePreferences(memories, context);
      }
      
      // No longer inject HTML markers since we can't capture Claude's response
      // The semantic extractor handles preference detection without needing Claude's analysis
      
      if (additionalContext) {
        return {
          additionalContext,
          memories: memories.length,
          preferences: preferencesStored
        };
      }
      
      return { preferences: preferencesStored };
      
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
  
  // Removed handleClaudeResponse - no mechanism to capture Claude's responses in current hook system
  
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
  
  /**
   * Enhanced memory formatting that shows only active preferences
   */
  private formatRetrievedMemoriesWithActivePreferences(memories: any[], context: MemoryServiceContext): string {
    if (memories.length === 0) return '';
    
    // Get active preferences separately to ensure no conflicts
    const activePreferences = this.memoryService.getActivePreferences(context);
    const projectKnowledge = memories.filter(m => m.type === 'project-knowledge');
    const otherMemories = memories.filter(m => m.type !== 'preference' && m.type !== 'project-knowledge');
    
    let formatted = '';
    
    // Format active preferences first - these are most important
    if (activePreferences.length > 0) {
      formatted += 'Current preferences and instructions:\n';
      
      // Group by preference key for better organization
      const preferencesByKey = new Map<string, any>();
      activePreferences.forEach(pref => {
        const key = pref.preference_key || 'general';
        if (!preferencesByKey.has(key)) {
          preferencesByKey.set(key, []);
        }
        preferencesByKey.get(key)!.push(pref);
      });
      
      // Format each preference type
      for (const [key, prefs] of preferencesByKey) {
        const latest = prefs.reduce((latest: any, current: any) => 
          current.timestamp > latest.timestamp ? current : latest
        );
        
        const pref = latest.value;
        if (pref.raw) {
          formatted += `- ${pref.raw}\n`;
        } else if (pref.subject && pref.action && pref.object) {
          formatted += `- ${pref.subject} ${pref.action} ${pref.object}\n`;
        } else if (pref.key && pref.value) {
          formatted += `- ${this.formatPreferenceKeyValue(pref.key, pref.value)}\n`;
        }
      }
      formatted += '\n';
    }
    
    // Add concise project knowledge
    if (projectKnowledge.length > 0) {
      formatted += 'Relevant context:\n';
      projectKnowledge.slice(0, 3).forEach(memory => {
        const content = memory.value.content || memory.value.description || '';
        const firstLine = content.split('\n')[0].substring(0, 100);
        if (firstLine) {
          formatted += `- ${firstLine}...\n`;
        }
      });
      formatted += '\n';
    }
    
    // Add other relevant memories if space allows
    if (otherMemories.length > 0 && activePreferences.length < 5) {
      formatted += 'Additional context:\n';
      otherMemories.slice(0, 3).forEach(memory => {
        formatted += `- ${memory.type}: ${JSON.stringify(memory.value).substring(0, 50)}...\n`;
      });
    }
    
    return formatted.trim();
  }

  /**
   * Format preference key-value pairs in human-readable form
   */
  private formatPreferenceKeyValue(key: string, value: string): string {
    switch (key) {
      case 'test_location':
        return `Tests should be saved in ${value}`;
      case 'indentation':
        return value === 'tabs' ? 'Use tabs for indentation' : `Use ${value.replace('_', ' ')} for indentation`;
      case 'http_client':
        return `Use ${value} for HTTP requests`;
      case 'test_framework':
        return `Use ${value} for testing`;
      case 'build_tool':
        return `Use ${value} as build tool`;
      case 'ui_framework':
        return `Use ${value} as UI framework`;
      default:
        return `${key.replace('_', ' ')}: ${value}`;
    }
  }

  private formatRetrievedMemories(memories: any[]): string {
    if (memories.length === 0) return '';
    
    // Filter and prioritize memories for clarity
    const preferences = memories.filter(m => m.type === 'preference');
    const projectKnowledge = memories.filter(m => m.type === 'project-knowledge');
    const otherMemories = memories.filter(m => m.type !== 'preference' && m.type !== 'project-knowledge');
    
    let formatted = '';
    
    // Format preferences first - these are most important for Claude's decision-making
    if (preferences.length > 0) {
      formatted += 'Previous instructions and preferences:\n';
      preferences.forEach(memory => {
        const pref = memory.value;
        if (pref.raw) {
          formatted += `- ${pref.raw}\n`;
        } else if (pref.subject && pref.action && pref.object) {
          formatted += `- ${pref.subject} ${pref.action} ${pref.object}\n`;
        }
      });
      formatted += '\n';
    }
    
    // Add concise project knowledge
    if (projectKnowledge.length > 0) {
      formatted += 'Relevant context:\n';
      projectKnowledge.slice(0, 3).forEach(memory => { // Limit to 3 most relevant
        const content = memory.value.content || memory.value.description || '';
        // Extract just the first meaningful line
        const firstLine = content.split('\n')[0].substring(0, 100);
        if (firstLine) {
          formatted += `- ${firstLine}...\n`;
        }
      });
      formatted += '\n';
    }
    
    // Add a few other relevant memories if space allows
    if (otherMemories.length > 0 && preferences.length < 5) {
      formatted += 'Additional context:\n';
      otherMemories.slice(0, 3).forEach(memory => {
        formatted += `- ${memory.type}: ${JSON.stringify(memory.value).substring(0, 50)}...\n`;
      });
    }
    
    return formatted.trim();
  }
}