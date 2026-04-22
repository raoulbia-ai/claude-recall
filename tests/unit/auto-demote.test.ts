import { MemoryStorage } from '../../src/memory/storage';

/**
 * Unit tests for citation-aware auto-demotion.
 * Covers threshold boundaries, age boundaries, cite_count guards, dry-run,
 * already-inactive rows, and the promoteRule safety valve.
 */

const DAY_MS = 86400000;

describe('MemoryStorage.demoteStaleRules', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  // Insert a fully-specified row bypassing save() dedup so we can control
  // load_count, cite_count, timestamp, and is_active precisely.
  function insertRule(params: {
    key: string;
    type: string;
    value: string;
    load_count: number;
    cite_count: number;
    ageDays: number;
    is_active?: boolean;
    superseded_by?: string | null;
  }): number {
    const db = storage.getDatabase();
    const ts = Date.now() - params.ageDays * DAY_MS;
    const result = db.prepare(`
      INSERT INTO memories (key, value, type, timestamp, load_count, cite_count, is_active, superseded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.key,
      JSON.stringify({ content: params.value }),
      params.type,
      ts,
      params.load_count,
      params.cite_count,
      params.is_active === false ? 0 : 1,
      params.superseded_by ?? null,
    );
    return result.lastInsertRowid as number;
  }

  function isActive(id: number): boolean {
    const row = storage.getDatabase()
      .prepare('SELECT is_active FROM memories WHERE id = ?')
      .get(id) as { is_active: number } | undefined;
    return row?.is_active === 1;
  }

  describe('demotion boundaries', () => {
    it('demotes rules at or above the load threshold with zero citations and sufficient age', () => {
      const id = insertRule({
        key: 'stale-rule', type: 'devops', value: 'never cited',
        load_count: 20, cite_count: 0, ageDays: 30,
      });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });

      expect(demoted.map(r => r.id)).toContain(id);
      expect(isActive(id)).toBe(false);
    });

    it('leaves rules below the load threshold untouched', () => {
      const id = insertRule({
        key: 'lightly-loaded', type: 'devops', value: 'fresh',
        load_count: 19, cite_count: 0, ageDays: 30,
      });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });

      expect(demoted.map(r => r.id)).not.toContain(id);
      expect(isActive(id)).toBe(true);
    });

    it('leaves cited rules untouched regardless of load count', () => {
      const id = insertRule({
        key: 'cited-rule', type: 'preference', value: 'actually useful',
        load_count: 500, cite_count: 1, ageDays: 365,
      });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });

      expect(demoted.map(r => r.id)).not.toContain(id);
      expect(isActive(id)).toBe(true);
    });

    it('leaves brand-new rules untouched even if load count qualifies', () => {
      const id = insertRule({
        key: 'new-rule', type: 'devops', value: 'too fresh to judge',
        load_count: 50, cite_count: 0, ageDays: 1,
      });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });

      expect(demoted.map(r => r.id)).not.toContain(id);
      expect(isActive(id)).toBe(true);
    });

    it('skips rules already marked inactive', () => {
      const id = insertRule({
        key: 'already-inactive', type: 'devops', value: 'retired',
        load_count: 100, cite_count: 0, ageDays: 30, is_active: false,
      });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });

      expect(demoted.map(r => r.id)).not.toContain(id);
    });

    it('excludes non-rule types (tool-use, failure-event, etc.)', () => {
      const toolUseId = insertRule({
        key: 'tool-use-row', type: 'tool-use', value: 'transient',
        load_count: 100, cite_count: 0, ageDays: 30,
      });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });

      expect(demoted.map(r => r.id)).not.toContain(toolUseId);
      expect(isActive(toolUseId)).toBe(true);
    });
  });

  describe('dry-run mode', () => {
    it('returns candidates without mutating rows', () => {
      const id = insertRule({
        key: 'dry-run-candidate', type: 'devops', value: 'would demote',
        load_count: 30, cite_count: 0, ageDays: 14,
      });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7, dryRun: true });

      expect(demoted.map(r => r.id)).toContain(id);
      expect(isActive(id)).toBe(true); // not mutated
    });
  });

  describe('demoteStaleRules mixed batch', () => {
    it('demotes only rows that match all criteria', () => {
      const stale = insertRule({ key: 's', type: 'devops', value: 'stale', load_count: 30, cite_count: 0, ageDays: 30 });
      const cited = insertRule({ key: 'c', type: 'devops', value: 'cited', load_count: 30, cite_count: 5, ageDays: 30 });
      const fresh = insertRule({ key: 'f', type: 'devops', value: 'fresh', load_count: 30, cite_count: 0, ageDays: 1 });
      const light = insertRule({ key: 'l', type: 'devops', value: 'light', load_count: 5, cite_count: 0, ageDays: 30 });

      const demoted = storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });

      const demotedIds = demoted.map(r => r.id);
      expect(demotedIds).toEqual([stale]);
      expect(isActive(stale)).toBe(false);
      expect(isActive(cited)).toBe(true);
      expect(isActive(fresh)).toBe(true);
      expect(isActive(light)).toBe(true);
    });
  });

  describe('promoteRule', () => {
    it('restores a previously auto-demoted rule', () => {
      const id = insertRule({
        key: 'to-restore', type: 'devops', value: 'come back',
        load_count: 50, cite_count: 0, ageDays: 30,
      });
      storage.demoteStaleRules({ minLoads: 20, minAgeDays: 7 });
      expect(isActive(id)).toBe(false);

      const ok = storage.promoteRule(id);

      expect(ok).toBe(true);
      expect(isActive(id)).toBe(true);
    });

    it('refuses to restore rules superseded by other mechanisms (preference override)', () => {
      const id = insertRule({
        key: 'pref-superseded', type: 'preference', value: 'overridden',
        load_count: 50, cite_count: 0, ageDays: 30,
        is_active: false, superseded_by: 'newer-preference-key',
      });

      const ok = storage.promoteRule(id);

      expect(ok).toBe(false);
      expect(isActive(id)).toBe(false); // still inactive
    });

    it('returns false for unknown ids', () => {
      const ok = storage.promoteRule(999999);
      expect(ok).toBe(false);
    });
  });
});
