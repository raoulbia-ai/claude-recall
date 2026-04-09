import { MemoryStorage } from '../../src/memory/storage';

/**
 * Fix 2 — search project_id leakage.
 *
 * Pre-fix bug: searchByContext({}) (or any call without project_id) silently
 * returned ALL memories from ALL projects, because the project_id filter was
 * conditional on context.project_id being truthy.
 *
 * Post-fix contract:
 *   - searchByContext requires either context.project_id OR
 *     context.includeAllProjects === true.
 *   - Calling it with neither must THROW (fail loud).
 *   - With project_id: returns project's own memories + universal-scoped memories.
 *   - With includeAllProjects: returns everything (for the --global CLI flag).
 */
describe('searchByContext project scoping', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');

    storage.save({
      key: 'a-mem',
      value: { content: 'project A note about apples' },
      type: 'project-knowledge',
      project_id: 'project-a',
    });

    storage.save({
      key: 'b-mem',
      value: { content: 'project B note about apples' },
      type: 'project-knowledge',
      project_id: 'project-b',
    });

    storage.save({
      key: 'u-mem',
      value: { content: 'universal note about apples' },
      type: 'preference',
      project_id: null as any,
      scope: 'universal',
    } as any);
  });

  afterEach(() => {
    storage.close();
  });

  it('throws when called without project_id and without includeAllProjects', () => {
    expect(() => storage.searchByContext({})).toThrow(/project_id/i);
  });

  it('returns project A + universal but NOT project B when scoped to project A', () => {
    const results = storage.searchByContext({ project_id: 'project-a' });
    const keys = results.map(r => r.key).sort();
    expect(keys).toContain('a-mem');
    expect(keys).toContain('u-mem');
    expect(keys).not.toContain('b-mem');
  });

  it('returns project B + universal but NOT project A when scoped to project B', () => {
    const results = storage.searchByContext({ project_id: 'project-b' });
    const keys = results.map(r => r.key).sort();
    expect(keys).toContain('b-mem');
    expect(keys).toContain('u-mem');
    expect(keys).not.toContain('a-mem');
  });

  it('returns all memories when includeAllProjects is true', () => {
    const results = storage.searchByContext({ includeAllProjects: true } as any);
    const keys = results.map(r => r.key).sort();
    expect(keys).toEqual(['a-mem', 'b-mem', 'u-mem']);
  });

  it('keyword filter still applies under project scoping', () => {
    storage.save({
      key: 'a-other',
      value: { content: 'project A note about oranges' },
      type: 'project-knowledge',
      project_id: 'project-a',
    });

    const results = storage.searchByContext({
      project_id: 'project-a',
      keywords: ['apples'],
    });
    const keys = results.map(r => r.key);
    expect(keys).toContain('a-mem');
    expect(keys).not.toContain('a-other');
    expect(keys).not.toContain('b-mem');
  });
});
