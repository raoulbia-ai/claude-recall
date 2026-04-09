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
  scope?: 'universal' | 'project' | null;  // v0.8.0: Memory scope
  globalSearch?: boolean;  // v0.8.0: For CLI --global flag
}

export interface ActiveRules {
  preferences: Memory[];
  corrections: Memory[];
  failures: Memory[];
  devops: Memory[];
  summary: string;
}

/** A rule scored and typed for sync to Claude Code's auto-memory directory. */
export interface SyncRule {
  key: string;
  crType: string;           // Claude Recall type (preference, correction, failure, devops, project-knowledge)
  ccType: 'feedback' | 'project';  // Claude Code type
  value: any;
  score: number;            // Composite ranking score
  cite_count: number;
  load_count: number;
  timestamp: number;
}

export interface ComplianceRule {
  key: string;
  type: string;
  value: string;
  load_count: number;
  cite_count: number;
}

export interface ComplianceReport {
  rules: ComplianceRule[];
  summary: {
    totalLoaded: number;
    totalCited: number;
    neverCited: number;
  };
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
      
      // Detect scope (v0.8.0)
      const scope = this.detectScope(request);

      const memory: Memory = {
        key: request.key,
        value: request.value,
        type: request.type,
        project_id: scope === 'universal' ? undefined : (request.context?.projectId || this.config.getProjectId()),
        file_path: request.context?.filePath,
        timestamp: request.context?.timestamp || Date.now(),
        relevance_score: request.relevanceScore || 1.0,
        scope: scope
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
  findRelevant(context: MemoryServiceContext, sortBy: 'relevance' | 'timestamp' = 'relevance'): ScoredMemory[] {
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

      const memories = this.retrieval.findRelevant(retrievalContext, sortBy);

      this.logger.logRetrieval(
        context.query || 'context-based',
        memories.length,
        {
          projectId: retrievalContext.project_id,
          filePath: retrievalContext.file_path,
          tool: retrievalContext.tool,
          keywords: retrievalContext.keywords,
          sortBy
        }
      );

      return memories;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'findRelevant', error as Error, context);
      throw error;
    }
  }
  
  /**
   * Search memories by keyword.
   *
   * Scope rules (post-Fix-2):
   *   - Default: scoped to current project (projectId from ConfigService) +
   *     universal/unscoped memories.
   *   - Pass opts.projectId to scope to a specific project.
   *   - Pass opts.includeAllProjects=true to opt into a true global search
   *     (used by `claude-recall search --global`).
   */
  search(
    query: string,
    optsOrSortBy:
      | 'relevance'
      | 'timestamp'
      | { sortBy?: 'relevance' | 'timestamp'; projectId?: string; includeAllProjects?: boolean } = 'relevance'
  ): ScoredMemory[] {
    const opts = typeof optsOrSortBy === 'string' ? { sortBy: optsOrSortBy } : optsOrSortBy;
    const sortBy = opts.sortBy || 'relevance';

    try {
      const context: Context = {
        query: query,
        timestamp: Date.now(),
      };

      if (opts.includeAllProjects) {
        (context as any).includeAllProjects = true;
      } else {
        context.project_id = opts.projectId || this.config.getProjectId();
      }

      const results = this.retrieval.findRelevant(context, sortBy);

      this.logger.logRetrieval(query, results.length, {
        searchType: 'contextual',
        sortBy,
        projectId: context.project_id,
        includeAllProjects: !!opts.includeAllProjects,
      });

      return results;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'search', error as Error, { query });
      throw error;
    }
  }
  
  /**
   * Enumerate ALL memories scoped to a project (project + universal + unscoped),
   * with NO ranking and NO result cap.
   *
   * Use this for stats, exports, and any other "give me everything in scope"
   * operation. Do NOT use search() / findRelevant() for enumeration — those
   * pre-rank by type priority and cap at top-5, which silently hides most
   * memories from callers that wanted a complete list.
   */
  getAllByProject(projectId: string): Memory[] {
    try {
      return this.storage.searchByContext({ project_id: projectId });
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'getAllByProject', error as Error, { projectId });
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
   * Delete a single memory by key
   */
  delete(key: string): boolean {
    try {
      const deleted = this.storage.deleteByKey(key);

      this.logger.logMemoryOperation('DELETE', {
        key,
        deleted
      });

      return deleted;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'delete', error as Error, { key });
      throw error;
    }
  }

  /**
   * Clear memories
   */
  clear(type?: string): number {
    try {
      const count = this.storage.clear(type);
      
      this.logger.logMemoryOperation('CLEAR', {
        type: type || 'all',
        count
      });
      
      return count;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'clear', error as Error, { type });
      throw error;
    }
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
   * Load all active rules deterministically by category.
   * Returns preferences, corrections, failures, and devops rules
   * scoped to current project + universal + unscoped memories.
   */
  loadActiveRules(projectId?: string): ActiveRules {
    try {
      const pid = projectId || this.config.getProjectId();
      const searchContext = { project_id: pid };

      // Preferences: active only
      const allPreferences = this.storage.searchByContext({ ...searchContext, type: 'preference' });
      const preferences = allPreferences.filter(m => m.is_active !== false);

      // Corrections: top 10 by timestamp
      const allCorrections = this.storage.searchByContext({ ...searchContext, type: 'correction' });
      const corrections = allCorrections
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 10);

      // Failures: top 5 by timestamp
      const allFailures = this.storage.searchByContext({ ...searchContext, type: 'failure' });
      const failures = allFailures
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 5);

      // DevOps: all rules
      const devops = this.storage.searchByContext({ ...searchContext, type: 'devops' });

      const counts = [
        preferences.length && `${preferences.length} preferences`,
        corrections.length && `${corrections.length} corrections`,
        failures.length && `${failures.length} failures`,
        devops.length && `${devops.length} devops rules`,
      ].filter(Boolean);

      const summary = counts.length > 0
        ? `Loaded ${counts.join(', ')}`
        : 'No active rules found';

      this.logger.info('MemoryService', summary, { projectId: pid });

      // Increment load_count for all returned rules
      const allIds = [
        ...preferences, ...corrections, ...failures, ...devops
      ].map(m => m.id).filter((id): id is number => id !== undefined);
      if (allIds.length > 0) {
        this.storage.incrementLoadCounts(allIds);
      }

      return { preferences, corrections, failures, devops, summary };
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'loadActiveRules', error as Error);
      return { preferences: [], corrections: [], failures: [], devops: [], summary: 'Error loading rules' };
    }
  }

  /**
   * Increment cite_count for a rule matched by key.
   * Called by the citation scanner in the stop hook.
   */
  incrementCiteCount(key: string): void {
    const memory = this.storage.retrieve(key);
    if (memory?.id) {
      this.storage.incrementCiteCount(memory.id);
    }
  }

  /**
   * Get top N rules scored for sync to Claude Code's auto-memory directory.
   * Scores by: (cite_count * 3) + (load_count * 0.5) + recency_bonus.
   * Maps Claude Recall types to CC types (feedback | project).
   */
  getTopRulesForSync(projectId?: string, limit: number = 30): SyncRule[] {
    const rules = this.loadActiveRules(projectId);
    const allMemories = [
      ...rules.preferences,
      ...rules.corrections,
      ...rules.failures,
      ...rules.devops,
    ];

    const now = Date.now();
    const DAY_MS = 86400000;

    const scored: SyncRule[] = allMemories.map(m => {
      const citeCount = m.cite_count ?? 0;
      const loadCount = m.load_count ?? 0;
      const ts = m.timestamp ?? 0;

      // Recency bonus: 2.0 for <7 days, 1.0 for <30 days, 0 for older
      const ageDays = (now - ts) / DAY_MS;
      const recencyBonus = ageDays < 7 ? 2.0 : ageDays < 30 ? 1.0 : 0;

      const score = (citeCount * 3) + (loadCount * 0.5) + recencyBonus;

      // Map CR type -> CC type
      const crType = m.type || 'preference';
      const ccType: 'feedback' | 'project' =
        (crType === 'project-knowledge' || crType === 'devops') ? 'project' : 'feedback';

      return {
        key: m.key,
        crType,
        ccType,
        value: m.value,
        score,
        cite_count: citeCount,
        load_count: loadCount,
        timestamp: ts,
      };
    });

    // Sort by score descending, then by recency
    scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

    return scored.slice(0, limit);
  }

  /**
   * Get all loaded rules across all projects (no project filter).
   */
  getAllLoadedRules(): Array<{key: string; type: string; value: string; load_count: number; cite_count: number}> {
    return this.storage.getRulesWithCompliance();
  }

  /**
   * Get all rule-type memories for citation matching (no load_count filter).
   * Citations may reference rules that weren't loaded via load_rules (e.g. from CLAUDE.md/Skills).
   */
  getAllRulesForCitationMatching(): Array<{key: string; type: string; value: string; load_count: number; cite_count: number}> {
    return this.storage.getAllRulesForCitationMatching();
  }

  /**
   * Get compliance report showing load vs cite rates for rules.
   */
  getComplianceReport(projectId?: string): ComplianceReport {
    const pid = projectId || this.config.getProjectId();
    const rules = this.storage.getRulesWithCompliance(pid);

    const loaded = rules.filter(r => r.load_count > 0);
    const cited = loaded.filter(r => r.cite_count > 0);
    const neverCited = loaded.filter(r => r.load_count >= 5 && r.cite_count === 0);

    return {
      rules: rules.map(r => ({
        key: r.key,
        type: r.type,
        value: r.value,
        load_count: r.load_count,
        cite_count: r.cite_count
      })),
      summary: {
        totalLoaded: loaded.length,
        totalCited: cited.length,
        neverCited: neverCited.length
      }
    };
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
   * Detect memory scope from request (v0.8.0)
   * @private
   */
  private detectScope(request: MemoryStoreRequest): 'universal' | 'project' | null {
    // Check explicit scope in context
    if (request.context?.scope) {
      return request.context.scope;
    }

    // Extract content for analysis
    const content = typeof request.value === 'string'
      ? request.value
      : JSON.stringify(request.value);

    const lowerContent = content.toLowerCase();

    // Explicit user indicators for universal scope
    if (lowerContent.includes('remember everywhere') ||
        lowerContent.includes('for all projects') ||
        lowerContent.includes('globally') ||
        lowerContent.includes('always use')) {
      return 'universal';
    }

    // Explicit user indicators for project scope
    if (lowerContent.includes('for this project') ||
        lowerContent.includes('project-specific') ||
        lowerContent.includes('only here') ||
        lowerContent.includes('in this project')) {
      return 'project';
    }

    // Default: unscoped (null) for backward compatibility
    return null;
  }

  /**
   * Update a memory record by key (used for fix pairing in hooks)
   */
  update(key: string, updates: Partial<Memory>): void {
    this.storage.update(key, updates);
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