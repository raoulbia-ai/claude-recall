import { MemoryStorage } from '../../src/memory/storage';
import * as fs from 'fs';
import * as path from 'path';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;
  
  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });
  
  afterEach(() => {
    storage.close();
  });
  
  it('should save and retrieve memories', () => {
    const memory = {
      key: 'test-key',
      value: { data: 'test' },
      type: 'preference',
      project_id: 'test-project',
      file_path: 'test.ts'
    };
    
    storage.save(memory);
    const retrieved = storage.retrieve('test-key');
    
    expect(retrieved).toBeDefined();
    expect(retrieved?.value).toEqual(memory.value);
    expect(retrieved?.type).toBe(memory.type);
    expect(retrieved?.project_id).toBe(memory.project_id);
    expect(retrieved?.file_path).toBe(memory.file_path);
  });
  
  it('should update access count on retrieval', () => {
    const memory = {
      key: 'access-test',
      value: { test: true },
      type: 'test'
    };
    
    storage.save(memory);
    
    const first = storage.retrieve('access-test');
    expect(first?.access_count).toBe(1);
    
    const second = storage.retrieve('access-test');
    expect(second?.access_count).toBe(2);
    expect(second?.last_accessed).toBeDefined();
  });
  
  it('should search memories by context', () => {
    storage.save({
      key: 'proj1-file1',
      value: { data: 1 },
      type: 'code',
      project_id: 'project1',
      file_path: 'file1.ts'
    });
    
    storage.save({
      key: 'proj1-file2',
      value: { data: 2 },
      type: 'code',
      project_id: 'project1',
      file_path: 'file2.ts'
    });
    
    storage.save({
      key: 'proj2-file1',
      value: { data: 3 },
      type: 'code',
      project_id: 'project2',
      file_path: 'file1.ts'
    });
    
    const project1Memories = storage.searchByContext({ project_id: 'project1' });
    expect(project1Memories).toHaveLength(2);
    
    const file1Memories = storage.searchByContext({ file_path: 'file1.ts', includeAllProjects: true } as any);
    expect(file1Memories).toHaveLength(2);
    
    const codeMemories = storage.searchByContext({ type: 'code', includeAllProjects: true } as any);
    expect(codeMemories).toHaveLength(3);
  });
  
  it('should search memories by query', () => {
    storage.save({
      key: 'auth-function',
      value: { name: 'validateAuth' },
      type: 'function'
    });
    
    storage.save({
      key: 'user-auth',
      value: { name: 'checkUser' },
      type: 'function'
    });
    
    storage.save({
      key: 'config',
      value: { authEnabled: true },
      type: 'config'
    });
    
    const authResults = storage.search('auth');
    expect(authResults.length).toBeGreaterThanOrEqual(2);
    expect(authResults.some(m => m.key === 'auth-function')).toBe(true);
    expect(authResults.some(m => m.key === 'user-auth')).toBe(true);
  });
  
  it('should get stats', () => {
    storage.save({ key: 'pref1', value: { name: 'pref1' }, type: 'preference' });
    storage.save({ key: 'pref2', value: { name: 'pref2' }, type: 'preference' });
    storage.save({ key: 'code1', value: { name: 'code1' }, type: 'code' });
    
    const stats = storage.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byType.preference).toBe(2);
    expect(stats.byType.code).toBe(1);
  });
  
  it('should handle memory updates', () => {
    const memory = {
      key: 'update-test',
      value: { version: 1 },
      type: 'test'
    };
    
    storage.save(memory);
    
    const updated = {
      key: 'update-test',
      value: { version: 2 },
      type: 'test'
    };
    
    storage.save(updated);
    
    const retrieved = storage.retrieve('update-test');
    expect(retrieved?.value).toEqual({ version: 2 });
  });
  
  it('should handle multiple initializations without errors', () => {
    // Create a temporary file for the database
    const tmpDb = path.join(__dirname, 'test-multi-init.db');
    
    try {
      // First initialization
      const storage1 = new MemoryStorage(tmpDb);
      storage1.save({
        key: 'init-test',
        value: { test: true },
        type: 'test'
      });
      storage1.close();
      
      // Second initialization - should not throw error
      const storage2 = new MemoryStorage(tmpDb);
      const retrieved = storage2.retrieve('init-test');
      expect(retrieved?.value).toEqual({ test: true });
      
      // Third initialization - verify idempotency
      const storage3 = new MemoryStorage(tmpDb);
      storage3.save({
        key: 'init-test-2',
        value: { test: 2 },
        type: 'test'
      });
      storage3.close();
      
      // Close second instance
      storage2.close();
      
      // Verify both records exist
      const storage4 = new MemoryStorage(tmpDb);
      expect(storage4.retrieve('init-test')).toBeDefined();
      expect(storage4.retrieve('init-test-2')).toBeDefined();
      storage4.close();
      
    } finally {
      // Clean up
      if (fs.existsSync(tmpDb)) {
        fs.unlinkSync(tmpDb);
      }
    }
  });

  describe('learning-loop repairs', () => {
    it('same-key re-save preserves load_count, cite_count and last_accessed', () => {
      storage.save({ key: 'counted', value: { rule: 'always use pnpm for installs' }, type: 'preference' });
      storage.getDatabase()
        .prepare('UPDATE memories SET load_count = 7, cite_count = 3, last_accessed = 12345 WHERE key = ?')
        .run('counted');

      // Same key, different content — must UPDATE in place, not delete+reinsert
      storage.save({ key: 'counted', value: { rule: 'always use pnpm for installs and ci' }, type: 'preference' });

      const row = storage.getDatabase()
        .prepare('SELECT load_count, cite_count, last_accessed FROM memories WHERE key = ?')
        .get('counted') as any;
      expect(row.load_count).toBe(7);
      expect(row.cite_count).toBe(3);
      expect(row.last_accessed).toBe(12345);
      expect(storage.retrieve('counted')?.value.rule).toContain('and ci');
    });

    it('re-saving identical content revives an auto-demoted rule', () => {
      storage.save({ key: 'rule-1', value: { rule: 'never push directly to the main branch' }, type: 'devops' });
      storage.getDatabase()
        .prepare(`UPDATE memories SET is_active = 0, superseded_by = 'auto-demote', superseded_at = 1 WHERE key = ?`)
        .run('rule-1');

      // User re-teaches the same rule under a new key → dedup must revive, not
      // silently bump a dead row
      storage.save({ key: 'rule-2', value: { rule: 'never push directly to the main branch' }, type: 'devops' });

      const revived = storage.retrieve('rule-1');
      expect(revived?.is_active).toBe(true);
      expect(revived?.superseded_by).toBeNull();
      expect(storage.retrieve('rule-2')).toBeNull(); // absorbed into revived row
    });

    it('does not revive rules superseded by a user override', () => {
      storage.save({ key: 'old-pref', value: { rule: 'use tabs for indentation everywhere' }, type: 'preference' });
      storage.getDatabase()
        .prepare(`UPDATE memories SET is_active = 0, superseded_by = 'new-pref-key', superseded_at = 1 WHERE key = ?`)
        .run('old-pref');

      storage.save({ key: 'restated', value: { rule: 'use tabs for indentation everywhere' }, type: 'preference' });

      // User-overridden row stays dead; the restated content gets its own row
      expect(storage.retrieve('old-pref')?.is_active).toBe(false);
      expect(storage.retrieve('restated')).not.toBeNull();
    });

    it('content-hash dedup does not swallow another project\'s memory', () => {
      storage.save({
        key: 'proj-a-rule',
        value: { rule: 'run migrations before every deploy to staging' },
        type: 'devops',
        project_id: 'proj-a'
      });

      // Identical content stored by a DIFFERENT project must get its own row
      storage.save({
        key: 'proj-b-rule',
        value: { rule: 'run migrations before every deploy to staging' },
        type: 'devops',
        project_id: 'proj-b'
      });

      expect(storage.retrieve('proj-a-rule')).not.toBeNull();
      expect(storage.retrieve('proj-b-rule')).not.toBeNull();
    });

    it('content-hash dedup still applies within the same project', () => {
      storage.save({
        key: 'first-key',
        value: { rule: 'run migrations before every deploy to staging' },
        type: 'devops',
        project_id: 'proj-a'
      });
      storage.save({
        key: 'second-key',
        value: { rule: 'run migrations before every deploy to staging' },
        type: 'devops',
        project_id: 'proj-a'
      });

      expect(storage.retrieve('second-key')).toBeNull(); // deduped into first
      expect(storage.retrieve('first-key')).not.toBeNull();
    });

    it('citation matching covers every demotable type (incl. failure)', () => {
      storage.save({ key: 'f1', value: { what_failed: 'npm test failed on missing dep' }, type: 'failure' });

      const rules = storage.getAllRulesForCitationMatching();
      expect(rules.some(r => r.type === 'failure')).toBe(true);
    });
  });

  describe('clear scoping', () => {
    it('clear with projectId deletes only that project, keeping others and unscoped rows', () => {
      storage.save({ key: 'a', value: { v: 'a' }, type: 'preference', project_id: 'proj-a' });
      storage.save({ key: 'b', value: { v: 'b' }, type: 'preference', project_id: 'proj-b' });
      storage.save({ key: 'u', value: { v: 'u' }, type: 'preference' }); // unscoped/universal

      const deleted = storage.clear(undefined, 'proj-a');

      expect(deleted).toBe(1);
      expect(storage.retrieve('a')).toBeNull();
      expect(storage.retrieve('b')).not.toBeNull();
      expect(storage.retrieve('u')).not.toBeNull();
    });

    it('clear without projectId deletes everything', () => {
      storage.save({ key: 'a', value: { v: 'a' }, type: 'preference', project_id: 'proj-a' });
      storage.save({ key: 'b', value: { v: 'b' }, type: 'preference', project_id: 'proj-b' });

      const deleted = storage.clear();

      expect(deleted).toBe(2);
      expect(storage.getStats().total).toBe(0);
    });
  });

  describe('update and mergeValue', () => {
    it('mergeValue should preserve existing value fields (fix pairing)', () => {
      storage.save({
        key: 'failure-1',
        value: {
          what_failed: 'npm test',
          why_failed: 'missing dependency',
          preventative_checks: ['run npm install first']
        },
        type: 'failure'
      });

      const merged = storage.mergeValue('failure-1', { what_should_do: 'Fix: npm install && npm test' });

      expect(merged).toBe(true);
      const retrieved = storage.retrieve('failure-1');
      expect(retrieved?.value.what_should_do).toBe('Fix: npm install && npm test');
      // The original counterfactual context must survive the merge
      expect(retrieved?.value.what_failed).toBe('npm test');
      expect(retrieved?.value.why_failed).toBe('missing dependency');
      expect(retrieved?.value.preventative_checks).toEqual(['run npm install first']);
    });

    it('mergeValue should return false for a missing key', () => {
      expect(storage.mergeValue('does-not-exist', { what_should_do: 'x' })).toBe(false);
    });

    it('mergeValue should recompute content_hash', () => {
      storage.save({ key: 'hash-test', value: { a: 1 }, type: 'failure' });
      const before = storage.retrieve('hash-test')?.content_hash;

      storage.mergeValue('hash-test', { b: 2 });

      const after = storage.retrieve('hash-test');
      expect(after?.content_hash).toBeDefined();
      expect(after?.content_hash).not.toBe(before);
      expect(after?.value).toEqual({ a: 1, b: 2 });
    });

    it('update should recompute content_hash when value changes', () => {
      storage.save({ key: 'upd-hash', value: { a: 1 }, type: 'failure' });
      const before = storage.retrieve('upd-hash')?.content_hash;

      storage.update('upd-hash', { value: { a: 2 } });

      const after = storage.retrieve('upd-hash');
      expect(after?.value).toEqual({ a: 2 });
      expect(after?.content_hash).not.toBe(before);
    });

    it('update should ignore unknown/unsafe field names and empty updates', () => {
      storage.save({ key: 'safe-upd', value: { a: 1 }, type: 'preference' });

      // Unknown columns must not reach the SET clause
      expect(() => storage.update('safe-upd', { 'evil = 1; --': 'x' } as any)).not.toThrow();
      expect(() => storage.update('safe-upd', {} as any)).not.toThrow();

      const retrieved = storage.retrieve('safe-upd');
      expect(retrieved?.value).toEqual({ a: 1 });
    });
  });
});