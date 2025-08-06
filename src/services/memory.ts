import { MemoryStorage, Memory } from '../memory/storage';
import { MemoryRetrieval, Context, ScoredMemory } from '../core/retrieval';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { ExtractedPreference } from './preference-extractor';

export interface MemoryServiceContext {
  projectId?: string;
  filePath?: string;
  tool?: string;
  type?: string;
  timestamp?: number;
  query?: string;
  keywords?: string[];
  sessionId?: string;
}

export interface MemoryStoreRequest {
  key: string;
  value: any;
  type: string;
  context?: MemoryServiceContext;
  relevanceScore?: number;
}

export class MemoryService {
  private static instance: MemoryService;
  private storage: MemoryStorage;
  private retrieval: MemoryRetrieval;
  private config = ConfigService.getInstance();
  private logger = LoggingService.getInstance();
  
  private constructor() {
    const dbPath = this.config.getDatabasePath();
    this.storage = new MemoryStorage(dbPath);
    this.retrieval = new MemoryRetrieval(this.storage);
    
    this.logger.info('MemoryService', `Initialized with database: ${dbPath}`);
  }
  
  static getInstance(): MemoryService {
    if (!MemoryService.instance) {
      MemoryService.instance = new MemoryService();
    }
    return MemoryService.instance;
  }
  
  /**
   * Store a memory with proper context and logging
   */
  store(request: MemoryStoreRequest): void {
    try {
      // Check memory limits and notify if approaching
      const stats = this.getStats();
      const config = this.config.getConfig();
      const maxMemories = config.database.compaction?.maxMemories || 10000;
      
      if (stats.total >= maxMemories * 0.8) {
        const percent = ((stats.total / maxMemories) * 100).toFixed(0);
        console.log(`⚠️  Memory usage at ${percent}% (${stats.total}/${maxMemories})`);
      }
      
      const memory: Memory = {
        key: request.key,
        value: request.value,
        type: request.type,
        project_id: request.context?.projectId || this.config.getProjectId(),
        file_path: request.context?.filePath,
        timestamp: request.context?.timestamp || Date.now(),
        relevance_score: request.relevanceScore || 1.0
      };
      
      this.storage.save(memory);
      
      this.logger.logMemoryOperation('STORE', {
        key: request.key,
        type: request.type,
        projectId: memory.project_id,
        filePath: memory.file_path
      });
      
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'store', error as Error, {
        key: request.key,
        type: request.type
      });
      throw error;
    }
  }
  
  /**
   * Retrieve a specific memory by key
   */
  retrieve(key: string): Memory | null {
    try {
      const memory = this.storage.retrieve(key);
      
      this.logger.logMemoryOperation('RETRIEVE', {
        key,
        found: !!memory,
        accessCount: memory?.access_count
      });
      
      return memory;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'retrieve', error as Error, { key });
      throw error;
    }
  }
  
  /**
   * Find relevant memories based on context
   */
  findRelevant(context: MemoryServiceContext): ScoredMemory[] {
    try {
      const retrievalContext: Context = {
        project_id: context.projectId || this.config.getProjectId(),
        file_path: context.filePath,
        tool: context.tool,
        type: context.type,
        timestamp: context.timestamp || Date.now(),
        query: context.query,
        keywords: context.keywords
      };
      
      const memories = this.retrieval.findRelevant(retrievalContext);
      
      this.logger.logRetrieval(
        context.query || 'context-based',
        memories.length,
        {
          projectId: retrievalContext.project_id,
          filePath: retrievalContext.file_path,
          tool: retrievalContext.tool,
          keywords: retrievalContext.keywords
        }
      );
      
      return memories;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'findRelevant', error as Error, context);
      throw error;
    }
  }
  
  /**
   * Search memories by keyword
   */
  search(query: string): ScoredMemory[] {
    try {
      // Use findRelevant with query context for better semantic matching
      const context = {
        query: query,
        timestamp: Date.now()
      };
      
      const results = this.retrieval.findRelevant(context);
      
      this.logger.logRetrieval(query, results.length, {
        searchType: 'contextual'
      });
      
      return results;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'search', error as Error, { query });
      throw error;
    }
  }
  
  /**
   * Get memory storage statistics
   */
  getStats(): { total: number; byType: Record<string, number> } {
    try {
      const stats = this.storage.getStats();
      
      this.logger.debug('MemoryService', 'Retrieved stats', stats);
      
      return stats;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'getStats', error as Error);
      throw error;
    }
  }
  
  /**
   * Store a tool use event
   */
  storeToolUse(toolName: string, toolInput: any, context: MemoryServiceContext): void {
    const key = `tool_use_${toolName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.store({
      key,
      value: {
        tool_name: toolName,
        tool_input: toolInput,
        session_id: context.sessionId,
        timestamp: Date.now()
      },
      type: 'tool-use',
      context,
      relevanceScore: 1.0
    });
  }
  
  /**
   * Store a user preference
   */
  storePreference(preference: any, context: MemoryServiceContext): void {
    const key = `preference_${preference.pattern}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.store({
      key,
      value: {
        ...preference,
        session_id: context.sessionId
      },
      type: 'preference',
      context,
      relevanceScore: 1.0
    });
  }
  
  /**
   * Store project knowledge
   */
  storeProjectKnowledge(knowledge: any, context: MemoryServiceContext): void {
    const key = `project_knowledge_${Date.now()}`;
    
    this.store({
      key,
      value: knowledge,
      type: 'project-knowledge',
      context,
      relevanceScore: 0.8
    });
  }
  
  /**
   * Store a preference with override handling
   */
  storePreferenceWithOverride(preference: ExtractedPreference, context: MemoryServiceContext): void {
    try {
      const key = `preference_${preference.key}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Handle override logic
      if (preference.isOverride) {
        this.markSupersededPreferences(preference.key, key, context);
      }
      
      const memory: Memory = {
        key,
        value: {
          ...preference,
          session_id: context.sessionId,
          preference_key: preference.key
        },
        type: 'preference',
        project_id: context.projectId || this.config.getProjectId(),
        file_path: context.filePath,
        timestamp: context.timestamp || Date.now(),
        relevance_score: preference.confidence,
        preference_key: preference.key,
        is_active: true,
        confidence_score: preference.confidence
      };
      
      this.storage.save(memory);
      
      this.logger.logMemoryOperation('STORE_PREFERENCE', {
        key,
        preferenceKey: preference.key,
        value: preference.value,
        isOverride: preference.isOverride,
        confidence: preference.confidence,
        projectId: memory.project_id
      });
      
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'storePreferenceWithOverride', error as Error, {
        preferenceKey: preference.key,
        value: preference.value
      });
      throw error;
    }
  }

  /**
   * Mark existing preferences as superseded
   */
  private markSupersededPreferences(preferenceKey: string, newPreferenceKey: string, context: MemoryServiceContext): void {
    try {
      const existingPreferences = this.getPreferencesByKey(preferenceKey, context);
      
      for (const existingPref of existingPreferences) {
        if (existingPref.is_active) {
          // Mark as superseded
          this.storage.markSuperseded(existingPref.key, newPreferenceKey);
          
          this.logger.debug('MemoryService', `Marked preference as superseded: ${existingPref.key}`, {
            preferenceKey,
            supersededBy: newPreferenceKey
          });
        }
      }
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'markSupersededPreferences', error as Error);
    }
  }

  /**
   * Get preferences by key
   */
  getPreferencesByKey(preferenceKey: string, context?: MemoryServiceContext): Memory[] {
    try {
      return this.storage.getByPreferenceKey(preferenceKey, context?.projectId);
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'getPreferencesByKey', error as Error);
      return [];
    }
  }

  /**
   * Get only active preferences
   */
  getActivePreferences(context: MemoryServiceContext): Memory[] {
    try {
      const allPreferences = this.storage.getPreferencesByContext({
        project_id: context.projectId || this.config.getProjectId(),
        file_path: context.filePath
      });
      
      // Group by preference key and return only active ones
      const activeByKey = new Map<string, Memory>();
      
      for (const pref of allPreferences) {
        const prefKey = pref.preference_key;
        if (!prefKey || !pref.is_active) continue;
        
        const current = activeByKey.get(prefKey);
        
        // If no current preference or this one is more recent
        if (!current || pref.timestamp! > current.timestamp!) {
          activeByKey.set(prefKey, pref);
        }
      }
      
      const activePreferences = Array.from(activeByKey.values());
      
      this.logger.debug('MemoryService', `Retrieved ${activePreferences.length} active preferences`, {
        preferenceKeys: activePreferences.map(p => p.preference_key),
        projectId: context.projectId
      });
      
      return activePreferences;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'getActivePreferences', error as Error);
      return [];
    }
  }

  /**
   * Mark a preference as superseded
   */
  markSuperseded(key: string, supersededBy: string): void {
    try {
      this.storage.markSuperseded(key, supersededBy);
      
      this.logger.logMemoryOperation('SUPERSEDE', {
        key,
        supersededBy
      });
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'markSuperseded', error as Error);
      throw error;
    }
  }

  /**
   * Get direct database access (for CLI operations)
   */
  getDatabase() {
    return this.storage.getDatabase();
  }
  
  /**
   * Check if database is connected
   */
  isConnected(): boolean {
    try {
      // Try to get stats as a connection check
      this.storage.getStats();
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Close database connection
   */
  close(): void {
    try {
      this.storage.close();
      this.logger.info('MemoryService', 'Database connection closed');
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'close', error as Error);
    }
  }
}