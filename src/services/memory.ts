import * as path from 'path';
import { MemoryStorage, Memory, MemoryOrigin, isTrustedMemory, quarantineEnabled, QUARANTINED_TYPES } from '../memory/storage';
import { redactSecrets, redactValue, screenForAttack } from './memory-guard';
import { MemoryRetrieval, Context, ScoredMemory } from '../core/retrieval';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { isTestPollution } from './test-pollution';
import { isBoilerplateFailureValue } from './memory-quality';

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
  solutions: Memory[];
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

/** Where a captured memory came from (see Memory.source_* in storage). */
export interface MemorySource {
  session?: string;
  transcript?: string;
  entry?: string;
  /** The user's text the memory was extracted from. */
  excerpt?: string;
}

export interface MemoryStoreRequest {
  key: string;
  value: any;
  type: string;
  context?: MemoryServiceContext;
  relevanceScore?: number;
  preferenceKey?: string;
  isOverride?: boolean;
  source?: MemorySource;
  /**
   * Where this memory came from. Required so every write path has to decide;
   * null only for content of genuinely unknown origin. Only 'user' is trusted.
   */
  origin: MemoryOrigin | null;
}

const SOURCE_ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

/** Longest excerpt kept: the most text a capture hook classifies. */
export const MAX_SOURCE_EXCERPT_CHARS = 2000;

/**
 * Keep only well-formed source fields. A source can arrive from an import
 * file, and search_memory hands the transcript path to the agent to read, so
 * it must look like a Claude Code transcript: an absolute path to a .jsonl.
 */
export function sanitizeSource(
  source?: MemorySource,
): Pick<Memory, 'source_session' | 'source_transcript' | 'source_entry' | 'source_excerpt'> {
  const id = (v: unknown) => (typeof v === 'string' && SOURCE_ID_SHAPE.test(v) ? v : null);
  const t = source?.transcript;
  const transcript = typeof t === 'string' && t.length <= 1024 && path.isAbsolute(t) && t.endsWith('.jsonl') ? t : null;
  return {
    source_session: id(source?.session),
    source_transcript: transcript,
    source_entry: id(source?.entry),
    source_excerpt: typeof source?.excerpt === 'string' && source.excerpt.trim()
      ? source.excerpt.slice(0, MAX_SOURCE_EXCERPT_CHARS)
      : null,
  };
}

/** What happened to a store request. */
export interface StoreOutcome {
  stored: boolean;
  /** Why it was refused, when it was. */
  reason?: string;
  /**
   * Stored, but in quarantine: it won't be loaded as a rule until the user
   * approves it (an untrusted origin while quarantine is on).
   */
  pending?: boolean;
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
   * Direct storage access for MCP handlers that need raw queries
   * (resources/prompts). Prefer the service methods where one exists.
   */
  getStorage(): MemoryStorage {
    return this.storage;
  }


  /**
   * Store a memory with proper context and logging
   */
  /**
   * Store a memory. Returns whether it was stored: test-fixture text and
   * attack-shaped text from an untrusted origin are refused, not thrown.
   */
  store(request: MemoryStoreRequest, opts?: { fuzzyNewestWins?: boolean }): StoreOutcome {
    try {
      // Write-time guard: silently drop values matching known test-fixture patterns
      // (Test preference 177…, Session test preference …, Memory with complex metadata,
      // Test memory content). Prevents legacy test harnesses from re-polluting the DB.
      if (isTestPollution(request.value)) {
        this.logger.info('MemoryService', 'Dropped test-pollution write', {
          key: request.key,
          type: request.type,
        });
        return { stored: false, reason: 'test fixture' };
      }

      // Guardrails (docs/design-memory-poisoning-defense.md). Secrets never
      // reach the store; attack-shaped text from anyone but the user is
      // refused. The user may legitimately state "never pipe curl to sh".
      const value = redactValue(request.value);
      const source = request.source?.excerpt
        ? { ...request.source, excerpt: redactSecrets(request.source.excerpt) }
        : request.source;
      const attack = screenForAttack(typeof value === 'string' ? value : JSON.stringify(value));
      if (attack.length > 0 && request.origin !== 'user') {
        const reason = `looks like an attack (${attack.join(', ')})`;
        this.logger.warn('MemoryService', `Refused ${request.origin ?? 'unknown'}-origin write: ${reason}`, {
          key: request.key,
          type: request.type,
        });
        // stderr: visible in hook logs and the MCP server log; never stdout (JSON-RPC)
        console.error(`🛡️  Recall refused a memory from ${request.origin ?? 'an unknown source'}: ${reason}`);
        return { stored: false, reason };
      }

      // Content the user already rejected stays rejected, however often an
      // untrusted path tries to store it again.
      const pending = quarantineEnabled() && request.origin !== 'user' && QUARANTINED_TYPES.includes(request.type);
      if (pending && this.storage.wasRejected(value, request.type, request.context?.projectId || this.config.getProjectId())) {
        this.logger.info('MemoryService', 'Refused write of content the user rejected', { key: request.key, type: request.type });
        return { stored: false, reason: 'the user already rejected this memory' };
      }

      // Check memory limits and notify if approaching
      const stats = this.getStats();
      const config = this.config.getConfig();
      const maxMemories = config.database.compaction?.maxMemories || 10000;
      
      if (stats.total >= maxMemories * 0.8) {
        const percent = ((stats.total / maxMemories) * 100).toFixed(0);
        // stderr — this runs inside the MCP server where stdout is JSON-RPC
        console.error(`⚠️  Memory usage at ${percent}% (${stats.total}/${maxMemories})`);
      }
      
      // Detect scope (v0.8.0)
      const scope = this.detectScope(request);

      const memory: Memory = {
        key: request.key,
        value,
        type: request.type,
        project_id: scope === 'universal' ? undefined : (request.context?.projectId || this.config.getProjectId()),
        file_path: request.context?.filePath,
        timestamp: request.context?.timestamp || Date.now(),
        relevance_score: request.relevanceScore || 1.0,
        scope: scope,
        preference_key: request.preferenceKey,
        is_active: true,
        ...sanitizeSource(source),
        origin: request.origin,
      };

      this.storage.save(memory, opts);

      this.logger.logMemoryOperation('STORE', {
        key: request.key,
        type: request.type,
        projectId: memory.project_id,
        filePath: memory.file_path
      });

      // Absorbed into an existing trusted rule by dedup? Then it isn't pending.
      const row = pending ? this.storage.retrieve(request.key) : null;
      const stillPending = pending && (row ? !isTrustedMemory(row) : true);
      return stillPending ? { stored: true, pending: true } : { stored: true };
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
      origin: 'tool',
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
   * Clear memories. With projectId, only that project's rows are deleted;
   * without it the wipe spans ALL projects.
   */
  clear(type?: string, projectId?: string): number {
    try {
      const count = this.storage.clear(type, projectId);

      this.logger.logMemoryOperation('CLEAR', {
        type: type || 'all',
        project: projectId || 'all',
        count
      });

      return count;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'clear', error as Error, { type, projectId });
      throw error;
    }
  }

  /**
   * Enumerate ALL memories across every project (for global export/backup).
   */
  getAllMemories(): Memory[] {
    try {
      return this.storage.searchByContext({ includeAllProjects: true });
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'getAllMemories', error as Error);
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
      origin: null, // no caller; origin unknown
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
      origin: null, // no caller; origin unknown
      value: knowledge,
      type: 'project-knowledge',
      context,
      relevanceScore: 0.8
    });
  }
  
  /**
   * Mark all currently-active memories with the given preference_key as superseded by newKey.
   * Returns the list of superseded keys so callers can surface them to the agent — this
   * closes the "I stored an override but the old rule is still in my context" gap.
   */
  supersedeByPreferenceKey(preferenceKey: string, newKey: string, context: MemoryServiceContext): string[] {
    if (!preferenceKey || !newKey) return [];
    const superseded: string[] = [];
    try {
      const pid = context.projectId || this.config.getProjectId();
      const existing = this.storage.getActiveByPreferenceKeyAnyType(preferenceKey, pid);
      for (const prev of existing) {
        if (prev.key !== newKey) {
          this.storage.markSuperseded(prev.key, newKey);
          superseded.push(prev.key);
        }
      }
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'supersedeByPreferenceKey', error as Error, { preferenceKey, newKey });
    }
    return superseded;
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
  loadActiveRules(projectId?: string, opts: { countLoad?: boolean } = {}): ActiveRules {
    try {
      const pid = projectId || this.config.getProjectId();
      const searchContext = { project_id: pid };

      // All categories filter is_active so auto-demoted rules are excluded
      // uniformly — and, with quarantine on (the default), memories the user
      // hasn't vouched for: they wait in `rules pending` until approved.
      const quarantine = quarantineEnabled();
      const isActive = (m: Memory) => m.is_active !== false && (!quarantine || isTrustedMemory(m));
      // Capped categories keep confirmed rules first, so the cap cuts
      // unconfirmed ones before rules checked against the user's words.
      const confirmedThenNewest = (a: Memory, b: Memory) =>
        (b.confirmed_at ? 1 : 0) - (a.confirmed_at ? 1 : 0) ||
        (b.timestamp || 0) - (a.timestamp || 0);

      // Preferences: active only
      const allPreferences = this.storage.searchByContext({ ...searchContext, type: 'preference' });
      const preferences = allPreferences.filter(isActive);

      // Corrections: top 10, confirmed first, then newest
      const allCorrections = this.storage.searchByContext({ ...searchContext, type: 'correction' });
      const corrections = allCorrections
        .filter(isActive)
        .sort(confirmedThenNewest)
        .slice(0, 10);

      // Failures: top 5, confirmed first, then newest
      const allFailures = this.storage.searchByContext({ ...searchContext, type: 'failure' });
      const failures = allFailures
        .filter(isActive)
        // Boilerplate-only lessons teach nothing, so they must not be injected
        // or counted. Same predicate memory-sync uses for the file index —
        // otherwise the surfaces contradict each other ("3 rules" vs "none synced").
        .filter(m => !isBoilerplateFailureValue(m.value))
        .sort(confirmedThenNewest)
        .slice(0, 5);

      // DevOps: all active rules
      const devops = this.storage.searchByContext({ ...searchContext, type: 'devops' }).filter(isActive);

      // Solutions: hard-won reusable resolutions, top 5, confirmed first, then newest
      const allSolutions = this.storage.searchByContext({ ...searchContext, type: 'solution' });
      const solutions = allSolutions
        .filter(isActive)
        .sort(confirmedThenNewest)
        .slice(0, 5);

      const counts = [
        preferences.length && `${preferences.length} preferences`,
        corrections.length && `${corrections.length} corrections`,
        failures.length && `${failures.length} failures`,
        devops.length && `${devops.length} devops rules`,
        solutions.length && `${solutions.length} solutions`,
      ].filter(Boolean);

      const summary = counts.length > 0
        ? `Loaded ${counts.join(', ')}`
        : 'No active rules found';

      this.logger.info('MemoryService', summary, { projectId: pid });

      // Increment load_count for all returned rules
      const allIds = [
        ...preferences, ...corrections, ...failures, ...devops, ...solutions
      ].map(m => m.id).filter((id): id is number => id !== undefined);
      // Showing the user their rules isn't the agent loading them: don't count it
      if (allIds.length > 0 && opts.countLoad !== false) {
        this.storage.incrementLoadCounts(allIds);
      }

      return { preferences, corrections, failures, devops, solutions, summary };
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'loadActiveRules', error as Error);
      return { preferences: [], corrections: [], failures: [], devops: [], solutions: [], summary: 'Error loading rules' };
    }
  }

  /**
   * How many memories steer the agent in this project: every active rule
   * (preferences, corrections, failures, devops, solutions) plus project
   * notes. One number for the status line and the session banner, so neither
   * has to name kinds. Doesn't count as the agent loading the rules.
   */
  countRules(projectId?: string): number {
    const r = this.loadActiveRules(projectId, { countLoad: false });
    return r.preferences.length + r.corrections.length + r.failures.length +
      r.devops.length + r.solutions.length + this.getActiveKnowledge(projectId).length;
  }

  /**
   * Active project-knowledge memories (facts about the project, surfaced by
   * relevance rather than loaded as rules), newest first. Same filters as
   * loadActiveRules: inactive and unreviewed ones are left out.
   */
  getActiveKnowledge(projectId?: string): Memory[] {
    const pid = projectId || this.config.getProjectId();
    const quarantine = quarantineEnabled();
    return this.storage.searchByContext({ project_id: pid, type: 'project-knowledge' })
      .filter(m => m.is_active !== false && (!quarantine || isTrustedMemory(m)))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
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
   * Auto-demote rules that burn context without earning citations.
   * Reads env vars: CLAUDE_RECALL_AUTO_DEMOTE (gate), CLAUDE_RECALL_DEMOTE_MIN_LOADS (default 20),
   * CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS (default 7).
   * Safe to call on every boot — idempotent, only acts on newly-qualifying rules.
   */
  autoDemoteStaleRules(options?: { minLoads?: number; minAgeDays?: number; dryRun?: boolean; force?: boolean }): Array<{id: number; key: string; type: string; load_count: number; cite_count: number; timestamp: number}> {
    const force = options?.force ?? false;
    if (!force && process.env.CLAUDE_RECALL_AUTO_DEMOTE !== 'true') {
      return [];
    }
    const minLoads = options?.minLoads ?? Number(process.env.CLAUDE_RECALL_DEMOTE_MIN_LOADS ?? 20);
    const minAgeDays = options?.minAgeDays ?? Number(process.env.CLAUDE_RECALL_DEMOTE_MIN_AGE_DAYS ?? 7);
    const dryRun = options?.dryRun ?? false;

    try {
      const demoted = this.storage.demoteStaleRules({ minLoads, minAgeDays, dryRun });
      if (demoted.length > 0) {
        this.logger.info('MemoryService',
          `${dryRun ? 'Would demote' : 'Demoted'} ${demoted.length} stale rules (load>=${minLoads}, cite=0, age>${minAgeDays}d)`,
          { count: demoted.length, dryRun });
      }
      return demoted;
    } catch (error) {
      this.logger.logServiceError('MemoryService', 'autoDemoteStaleRules', error as Error);
      return [];
    }
  }

  /**
   * Restore an auto-demoted rule. Returns true if the row was flipped back.
   */
  promoteRule(id: number): boolean {
    return this.storage.promoteRule(id);
  }

  /**
   * Delete legacy test-fixture rows that leaked into the production DB.
   * Destructive — exposed via CLI only, not called from boot.
   */
  cleanupTestPollution(options?: { dryRun?: boolean }): Array<{id: number; key: string; type: string; value: string}> {
    return this.storage.deleteTestPollution(options);
  }

  /**
   * Retroactive fuzzy dedup. Write-time dedup (findFuzzyDuplicate) handles new
   * writes; this method catches duplicates that predate it or crossed its threshold.
   */
  dedupSimilarRules(options?: { threshold?: number; dryRun?: boolean }): Array<{winnerId: number; winnerKey: string; loserId: number; loserKey: string; similarity: number}> {
    return this.storage.dedupSimilar(options ?? {});
  }

  /** Memories waiting for the user's review (quarantine). */
  getPendingRules(opts: { projectId?: string; type?: string; origin?: string } = {}): Memory[] {
    return this.storage.getPendingRules(opts);
  }

  countPending(projectId?: string): number {
    try {
      return quarantineEnabled() ? this.storage.countPending(projectId || this.config.getProjectId()) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Retire unreviewed failures older than CLAUDE_RECALL_PENDING_FAILURE_DAYS
   * (default 14; -1 keeps them). Called where a session starts, so the queue
   * the user is told about is already trimmed. Never throws.
   */
  expireStalePending(): number {
    try {
      if (!quarantineEnabled()) return 0;
      const days = parseInt(process.env.CLAUDE_RECALL_PENDING_FAILURE_DAYS || '14', 10);
      const n = this.storage.expirePendingFailures(Number.isNaN(days) ? 14 : days);
      if (n > 0) this.logger.info('MemoryService', `Expired ${n} unreviewed failure(s) from quarantine`);
      return n;
    } catch {
      return 0;
    }
  }

  /** Approve memories out of quarantine. Only the user does this, never an agent tool. */
  approveRules(ids: number[]): number {
    return this.storage.approveRules(ids);
  }

  /** Reject memories: deactivated, and the same content is refused if stored again. */
  rejectRules(ids: number[]): number {
    return this.storage.rejectRules(ids);
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

    // Project indicators FIRST: they are the more specific signal. Checking
    // universal first meant "always use --no-verify in this project" matched
    // "always use" and leaked the rule to every project.
    if (lowerContent.includes('for this project') ||
        lowerContent.includes('project-specific') ||
        lowerContent.includes('only here') ||
        lowerContent.includes('in this project')) {
      return 'project';
    }

    // Explicit user indicators for universal scope
    if (lowerContent.includes('remember everywhere') ||
        lowerContent.includes('for all projects') ||
        lowerContent.includes('globally') ||
        lowerContent.includes('always use')) {
      return 'universal';
    }

    // Default: unscoped (null) for backward compatibility
    return null;
  }

  /**
   * Update a memory record by key. Replaces `value` wholesale — for enriching
   * an existing value without destroying its other fields, use mergeIntoValue().
   */
  update(key: string, updates: Partial<Memory>): void {
    this.storage.update(key, updates);
  }

  /**
   * Merge fields into an existing memory's JSON value, preserving the rest of
   * the record (used for fix pairing in hooks). Returns false if key missing.
   */
  mergeIntoValue(key: string, partial: Record<string, any>): boolean {
    return this.storage.mergeValue(key, partial);
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