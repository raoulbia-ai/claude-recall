/**
 * Unit tests for src/services/memory.ts (MemoryService).
 *
 * MemoryService is a getInstance() singleton whose ConfigService dependency
 * caches env-derived paths at first construction. All isolation env vars are
 * therefore set BEFORE the module is required (jest.resetModules + dynamic
 * require in beforeAll), and one temp-dir-backed instance is shared by the
 * whole suite. The real ~/.claude-recall is never touched: DB, logs, and
 * project dir all point at a fs.mkdtempSync() directory that is removed in
 * afterAll.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MemoryService } from '../../src/services/memory';

const PROJECT = 'msvc-test-project';

const ENV_KEYS = [
  'CLAUDE_RECALL_DB_PATH',
  'CLAUDE_RECALL_LOG_DIR',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_PROJECT_ID',
] as const;

describe('MemoryService', () => {
  let testDir: string;
  let savedEnv: Record<string, string | undefined>;
  let service: MemoryService;

  beforeAll(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-recall-msvc-'));
    process.env.CLAUDE_RECALL_DB_PATH = testDir;
    process.env.CLAUDE_RECALL_LOG_DIR = path.join(testDir, 'logs');
    process.env.CLAUDE_PROJECT_DIR = testDir;
    process.env.CLAUDE_PROJECT_ID = PROJECT;

    // Fresh module registry so the ConfigService/LoggingService/MemoryService
    // singletons are constructed AFTER the env vars above are in place.
    jest.resetModules();
    const mod = require('../../src/services/memory') as typeof import('../../src/services/memory');
    service = mod.MemoryService.getInstance();
  });

  afterAll(() => {
    service.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('store + retrieve', () => {
    it('round-trips a memory and defaults project_id to the configured project', () => {
      service.store({
        key: 'rt_1',
        value: { content: 'round trip fixture value' },
        type: 'project-knowledge',
      });

      const mem = service.retrieve('rt_1');
      expect(mem).not.toBeNull();
      expect(mem!.value.content).toBe('round trip fixture value');
      expect(mem!.type).toBe('project-knowledge');
      expect(mem!.project_id).toBe(PROJECT);
    });

    it('honors an explicit context.projectId', () => {
      service.store({
        key: 'ctx_proj_1',
        value: { content: 'belongs to beta project fixture' },
        type: 'project-knowledge',
        context: { projectId: 'proj-beta' },
      });

      expect(service.retrieve('ctx_proj_1')!.project_id).toBe('proj-beta');
    });

    it('retrieve returns null for a missing key', () => {
      expect(service.retrieve('no_such_key_anywhere')).toBeNull();
    });

    it('silently drops writes matching test-pollution patterns', () => {
      service.store({
        key: 'pollution_1',
        value: 'Test memory content',
        type: 'preference',
      });

      expect(service.retrieve('pollution_1')).toBeNull();
    });
  });

  describe('getAllByProject', () => {
    it('returns project-scoped AND unscoped rows, excluding other projects', () => {
      // Unscoped row (project_id NULL) written through raw storage
      service.getStorage().save({
        key: 'unscoped_1',
        value: { content: 'unscoped row fixture' },
        type: 'project-knowledge',
      });

      const keys = service.getAllByProject('proj-beta').map(m => m.key);
      expect(keys).toContain('ctx_proj_1');   // proj-beta row
      expect(keys).toContain('unscoped_1');   // unscoped row
      expect(keys).not.toContain('rt_1');     // scoped to PROJECT, not proj-beta
    });
  });

  describe('detectScope (through store())', () => {
    it('detects project scope from "for this project"', () => {
      service.store({
        key: 'scope_project_1',
        value: 'use tabs for this project',
        type: 'preference',
      });

      const mem = service.retrieve('scope_project_1')!;
      expect(mem.scope).toBe('project');
      expect(mem.project_id).toBe(PROJECT);
    });

    it('detects universal scope from "always use ... globally" and stores NULL project_id', () => {
      service.store({
        key: 'scope_universal_1',
        value: 'always use pnpm globally',
        type: 'preference',
      });

      const mem = service.retrieve('scope_universal_1')!;
      expect(mem.scope).toBe('universal');
      expect(mem.project_id ?? null).toBeNull();
    });

    it('project indicators win over universal indicators in the same content', () => {
      // Regression guard: "always use --no-verify in this project" must stay project-scoped
      service.store({
        key: 'scope_precedence_1',
        value: 'always use --no-verify in this project',
        type: 'preference',
      });

      expect(service.retrieve('scope_precedence_1')!.scope).toBe('project');
    });

    it('explicit context.scope wins over content indicators', () => {
      service.store({
        key: 'scope_explicit_1',
        value: 'use two-space indent in this project',
        type: 'preference',
        context: { scope: 'universal' },
      });

      const mem = service.retrieve('scope_explicit_1')!;
      expect(mem.scope).toBe('universal');
      expect(mem.project_id ?? null).toBeNull();
    });

    it('plain content stays unscoped (scope null)', () => {
      service.store({
        key: 'scope_plain_1',
        value: 'prefer descriptive variable names',
        type: 'preference',
      });

      expect(service.retrieve('scope_plain_1')!.scope ?? null).toBeNull();
    });
  });

  describe('storePreferenceWithOverride + supersession', () => {
    it('supersedes the previous preference with the same preference_key on override', () => {
      service.storePreferenceWithOverride(
        { key: 'pk1', value: 'tabs', confidence: 0.9, raw: 'we use tabs here', isOverride: false, overrideSignals: [] },
        { projectId: PROJECT }
      );
      service.storePreferenceWithOverride(
        { key: 'pk1', value: 'spaces', confidence: 0.95, raw: 'actually, spaces now', isOverride: true, overrideSignals: ['actually'] },
        { projectId: PROJECT }
      );

      const all = service.getPreferencesByKey('pk1', { projectId: PROJECT });
      expect(all).toHaveLength(2);

      const active = all.filter(p => p.is_active !== false);
      const superseded = all.filter(p => p.is_active === false);
      expect(active).toHaveLength(1);
      expect(superseded).toHaveLength(1);
      expect((active[0].value as any).value).toBe('spaces');
      expect(superseded[0].superseded_by).toBe(active[0].key);

      // loadActiveRules only surfaces the new one for this preference_key
      const rules = service.loadActiveRules();
      const pk1Rules = rules.preferences.filter(p => p.preference_key === 'pk1');
      expect(pk1Rules).toHaveLength(1);
      expect((pk1Rules[0].value as any).value).toBe('spaces');
    });

    it('supersedes an UNSCOPED (NULL project_id) preference when the override is project-scoped', () => {
      // Regression for the NULL-inclusive fix: the first preference has no
      // project_id; the override carries one and must still supersede it.
      service.getStorage().save({
        key: 'null_pref_old',
        value: { content: 'old unscoped preference rule' },
        type: 'preference',
        preference_key: 'pk_null',
        is_active: true,
      });

      service.storePreferenceWithOverride(
        { key: 'pk_null', value: 'new-value', confidence: 0.9, raw: 'switch to new-value', isOverride: true, overrideSignals: ['switch to'] },
        { projectId: PROJECT }
      );

      const old = service.retrieve('null_pref_old')!;
      expect(old.is_active).toBe(false);
      expect(old.superseded_by).toBeTruthy();
    });
  });

  describe('supersedeByPreferenceKey', () => {
    it('marks all active rules with the key as superseded and returns their keys', () => {
      service.getStorage().save({
        key: 'sup_a', value: { content: 'supersede fixture a' }, type: 'devops',
        project_id: PROJECT, preference_key: 'pk_sup', is_active: true,
      });
      service.getStorage().save({
        key: 'sup_b', value: { content: 'supersede fixture b' }, type: 'preference',
        project_id: PROJECT, preference_key: 'pk_sup', is_active: true,
      });

      const superseded = service.supersedeByPreferenceKey('pk_sup', 'sup_new', { projectId: PROJECT });

      expect(superseded.sort()).toEqual(['sup_a', 'sup_b']);
      expect(service.retrieve('sup_a')!.is_active).toBe(false);
      expect(service.retrieve('sup_b')!.superseded_by).toBe('sup_new');
    });

    it('returns [] when preferenceKey or newKey is empty', () => {
      expect(service.supersedeByPreferenceKey('', 'new_key', {})).toEqual([]);
      expect(service.supersedeByPreferenceKey('pk_sup', '', {})).toEqual([]);
    });
  });

  describe('loadActiveRules', () => {
    it('groups active rules by type, excludes is_active=0, and increments load_count', () => {
      service.getStorage().save({
        key: 'rule_corr_active', value: { content: 'active correction fixture' },
        type: 'correction', project_id: PROJECT, is_active: true,
      });
      service.getStorage().save({
        key: 'rule_corr_inactive', value: { content: 'inactive correction fixture' },
        type: 'correction', project_id: PROJECT, is_active: false,
      });
      service.getStorage().save({
        key: 'rule_fail_1', value: { content: 'failure fixture lesson' },
        type: 'failure', project_id: PROJECT, is_active: true,
      });
      service.getStorage().save({
        key: 'rule_devops_1', value: { content: 'devops fixture rule' },
        type: 'devops', project_id: PROJECT, is_active: true,
      });

      const rules = service.loadActiveRules();

      const correctionKeys = rules.corrections.map(m => m.key);
      expect(correctionKeys).toContain('rule_corr_active');
      expect(correctionKeys).not.toContain('rule_corr_inactive');
      expect(rules.failures.map(m => m.key)).toContain('rule_fail_1');
      expect(rules.devops.map(m => m.key)).toContain('rule_devops_1');
      expect(rules.preferences.length).toBeGreaterThan(0);
      expect(rules.summary).toMatch(/^Loaded /);

      // load_count incremented in the DB for returned rules
      const row = service.getDatabase()
        .prepare('SELECT load_count FROM memories WHERE key = ?')
        .get('rule_corr_active') as { load_count: number };
      expect(row.load_count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('mergeIntoValue', () => {
    it('merges fields into an existing value and returns true', () => {
      service.store({
        key: 'merge_1',
        value: { content: 'merge target fixture' },
        type: 'project-knowledge',
      });

      expect(service.mergeIntoValue('merge_1', { fix: 'applied a fix' })).toBe(true);

      const mem = service.retrieve('merge_1')!;
      expect(mem.value.content).toBe('merge target fixture');
      expect(mem.value.fix).toBe('applied a fix');
    });

    it('returns false for a missing key', () => {
      expect(service.mergeIntoValue('missing_merge_key', { a: 1 })).toBe(false);
    });
  });

  describe('clear + getAllMemories', () => {
    it('clear(type, projectId) only removes matching rows in that project', () => {
      service.store({
        key: 'clear_pref_1', value: { content: 'clearable pref fixture' },
        type: 'preference', context: { projectId: 'proj-clear' },
      });
      service.store({
        key: 'clear_know_1', value: { content: 'surviving knowledge fixture' },
        type: 'project-knowledge', context: { projectId: 'proj-clear' },
      });

      const removed = service.clear('preference', 'proj-clear');

      expect(removed).toBe(1);
      expect(service.retrieve('clear_pref_1')).toBeNull();
      expect(service.retrieve('clear_know_1')).not.toBeNull();
      // Other projects untouched
      expect(service.retrieve('rt_1')).not.toBeNull();
    });

    it('getAllMemories returns rows across all projects', () => {
      const keys = service.getAllMemories().map(m => m.key);
      expect(keys).toContain('rt_1');        // PROJECT
      expect(keys).toContain('ctx_proj_1');  // proj-beta
      expect(keys).toContain('unscoped_1');  // NULL project
    });
  });

  describe('search', () => {
    it('scopes to the current project by default and spans all with includeAllProjects', () => {
      service.store({
        key: 'search_local_1',
        value: { content: 'zebrafish local knowledge fixture' },
        type: 'project-knowledge',
      });
      service.store({
        key: 'search_other_1',
        value: { content: 'zebrafish notes stored elsewhere entirely' },
        type: 'project-knowledge',
        context: { projectId: 'proj-search-other' },
      });

      const scoped = service.search('zebrafish').map(m => m.key);
      expect(scoped).toContain('search_local_1');
      expect(scoped).not.toContain('search_other_1');

      const global = service.search('zebrafish', { includeAllProjects: true }).map(m => m.key);
      expect(global).toContain('search_local_1');
      expect(global).toContain('search_other_1');
    });

    it('accepts the legacy sortBy string form', () => {
      const results = service.search('zebrafish', 'timestamp');
      expect(results.map(m => m.key)).toContain('search_local_1');
    });
  });

  describe('findRelevant', () => {
    it('returns scored memories for a query context', () => {
      const results = service.findRelevant({ query: 'zebrafish' });
      expect(results.length).toBeGreaterThan(0);
      expect(typeof results[0].score).toBe('number');
    });
  });

  describe('convenience store wrappers', () => {
    it('storeToolUse stores a tool-use memory', () => {
      service.storeToolUse('Bash', { command: 'ls -la fixtures' }, { sessionId: 'sess-tool-1' });

      const toolUses = service.getStorage().searchByContext({ project_id: PROJECT, type: 'tool-use' });
      const match = toolUses.find(m => (m.value as any).tool_name === 'Bash');
      expect(match).toBeDefined();
      expect((match!.value as any).session_id).toBe('sess-tool-1');
    });

    it('storePreference stores a preference memory', () => {
      service.storePreference(
        { pattern: 'indent_width', value: 'four spaces indent width fixture' },
        { sessionId: 'sess-pref-1' }
      );

      const prefs = service.getStorage().searchByContext({ project_id: PROJECT, type: 'preference' });
      expect(prefs.some(m => (m.value as any).pattern === 'indent_width')).toBe(true);
    });

    it('storeProjectKnowledge stores project knowledge', () => {
      service.storeProjectKnowledge(
        { fact: 'uses better-sqlite3 with WAL fixture' },
        { sessionId: 'sess-know-1' }
      );

      const knowledge = service.getStorage().searchByContext({ project_id: PROJECT, type: 'project-knowledge' });
      expect(knowledge.some(m => (m.value as any).fact === 'uses better-sqlite3 with WAL fixture')).toBe(true);
    });
  });

  describe('active preferences and citations', () => {
    it('getActivePreferences returns one active preference per key', () => {
      const active = service.getActivePreferences({ projectId: PROJECT });
      const pk1 = active.filter(p => p.preference_key === 'pk1');
      expect(pk1).toHaveLength(1);
      expect((pk1[0].value as any).value).toBe('spaces');
    });

    it('incrementCiteCount bumps cite_count for an existing key and ignores missing keys', () => {
      service.incrementCiteCount('rule_devops_1');
      const row = service.getDatabase()
        .prepare('SELECT cite_count FROM memories WHERE key = ?')
        .get('rule_devops_1') as { cite_count: number };
      expect(row.cite_count).toBe(1);

      expect(() => service.incrementCiteCount('no_such_rule_key')).not.toThrow();
    });

    it('markSuperseded flips is_active and records the successor', () => {
      service.getStorage().save({
        key: 'mark_sup_1', value: { content: 'to be marked superseded fixture' },
        type: 'preference', project_id: PROJECT, is_active: true,
      });

      service.markSuperseded('mark_sup_1', 'mark_sup_2');

      const mem = service.retrieve('mark_sup_1')!;
      expect(mem.is_active).toBe(false);
      expect(mem.superseded_by).toBe('mark_sup_2');
    });
  });

  describe('sync + compliance reporting', () => {
    it('getTopRulesForSync scores rules and maps CR types to CC types', () => {
      const top = service.getTopRulesForSync(PROJECT, 5);

      expect(top.length).toBeGreaterThan(0);
      expect(top.length).toBeLessThanOrEqual(5);
      for (const rule of top) {
        expect(typeof rule.score).toBe('number');
        if (rule.crType === 'devops' || rule.crType === 'project-knowledge') {
          expect(rule.ccType).toBe('project');
        } else {
          expect(rule.ccType).toBe('feedback');
        }
      }
      // devops rule seeded earlier must map to 'project'
      const devops = service.getTopRulesForSync(PROJECT, 30).find(r => r.key === 'rule_devops_1');
      expect(devops?.ccType).toBe('project');
    });

    it('getComplianceReport returns rules plus summary counts', () => {
      const report = service.getComplianceReport(PROJECT);

      expect(Array.isArray(report.rules)).toBe(true);
      expect(report.summary.totalLoaded).toBeGreaterThanOrEqual(0);
      expect(report.summary.totalCited).toBeGreaterThanOrEqual(0);
      expect(report.summary.neverCited).toBeGreaterThanOrEqual(0);
    });

    it('getAllLoadedRules and getAllRulesForCitationMatching return arrays', () => {
      expect(Array.isArray(service.getAllLoadedRules())).toBe(true);
      const citable = service.getAllRulesForCitationMatching();
      expect(Array.isArray(citable)).toBe(true);
      expect(citable.some(r => r.key === 'rule_devops_1')).toBe(true);
    });
  });

  describe('maintenance operations', () => {
    it('autoDemoteStaleRules is a no-op without the env gate, and runs with force', () => {
      expect(service.autoDemoteStaleRules()).toEqual([]);
      // force + dryRun exercises the storage path without mutating anything
      const wouldDemote = service.autoDemoteStaleRules({ force: true, dryRun: true, minLoads: 1, minAgeDays: 0 });
      expect(Array.isArray(wouldDemote)).toBe(true);
    });

    it('promoteRule returns false for an unknown id', () => {
      expect(service.promoteRule(999999)).toBe(false);
    });

    it('cleanupTestPollution and dedupSimilarRules run in dry-run mode', () => {
      expect(Array.isArray(service.cleanupTestPollution({ dryRun: true }))).toBe(true);
      expect(Array.isArray(service.dedupSimilarRules({ dryRun: true }))).toBe(true);
    });

    it('update modifies whitelisted columns', () => {
      service.update('rt_1', { relevance_score: 0.42 });
      expect(service.retrieve('rt_1')!.relevance_score).toBeCloseTo(0.42);
    });

    it('delete removes a memory and reports whether anything was deleted', () => {
      service.getStorage().save({
        key: 'delete_me_1', value: { content: 'deletable fixture row' },
        type: 'project-knowledge', project_id: PROJECT,
      });

      expect(service.delete('delete_me_1')).toBe(true);
      expect(service.retrieve('delete_me_1')).toBeNull();
      expect(service.delete('delete_me_1')).toBe(false);
    });

    it('getStats counts memories by type', () => {
      const stats = service.getStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType['project-knowledge']).toBeGreaterThan(0);
    });

    it('isConnected reports true while the database is open', () => {
      expect(service.isConnected()).toBe(true);
    });
  });

  describe('checkpoints', () => {
    it('save/has/load/delete round trip', () => {
      expect(service.hasCheckpoint('proj-ckpt')).toBe(false);

      service.saveCheckpoint('proj-ckpt', {
        completed: 'wrote the storage layer',
        remaining: 'wire the CLI command',
        blockers: 'none',
        notes: 'see src/memory/storage.ts',
      });

      expect(service.hasCheckpoint('proj-ckpt')).toBe(true);
      const ckpt = service.loadCheckpoint('proj-ckpt');
      expect(ckpt).not.toBeNull();
      expect(ckpt!.completed).toBe('wrote the storage layer');
      expect(ckpt!.remaining).toBe('wire the CLI command');

      expect(service.deleteCheckpoint('proj-ckpt')).toBe(true);
      expect(service.hasCheckpoint('proj-ckpt')).toBe(false);
      expect(service.deleteCheckpoint('proj-ckpt')).toBe(false);
    });
  });
});
