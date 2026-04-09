import { MemoryStorage } from '../../src/memory/storage';

/**
 * Fix 3 (pivoted) — stats CLI uses ranked/capped search for enumeration.
 *
 * Pre-fix bug: getProjectStats(), showSkillsEvolution(), showFailures(), export
 * all called memoryService.search('') and treated the result as "all memories".
 * But MemoryService.search → MemoryRetrieval.findRelevant returns at most 5
 * results (slice(0, 5)), pre-ranked by type priority that buries everything
 * except project-knowledge. Net effect: stats massively underreport.
 *
 * Post-fix contract:
 *   - storage.searchByContext({ project_id }) returns ALL memories scoped
 *     to (project + universal + unscoped), with no ranking and no cap.
 *   - MemoryService.getAllByProject is a thin wrapper around the storage call,
 *     and is what stats/export/enumeration callers should use instead of search().
 *   - search() remains for relevance-ranked retrieval (top-N).
 *
 * This file tests the storage-layer guarantee (the wrapper has no extra logic).
 */
describe('storage enumeration — no ranking, no cap', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');

    // Insert 20 memories of varied types in project A.
    const types = ['preference', 'correction', 'failure', 'devops', 'project-knowledge'];
    for (let i = 0; i < 20; i++) {
      storage.save({
        key: `a-${i}`,
        value: { content: `entry ${i}` },
        type: types[i % types.length],
        project_id: 'project-a',
      });
    }

    // 5 memories in project B (must NOT leak into project A enumeration).
    for (let i = 0; i < 5; i++) {
      storage.save({
        key: `b-${i}`,
        value: { content: `b entry ${i}` },
        type: 'preference',
        project_id: 'project-b',
      });
    }

    // 3 universal memories (should be included in any project's enumeration).
    for (let i = 0; i < 3; i++) {
      storage.save({
        key: `u-${i}`,
        value: { content: `universal ${i}` },
        type: 'preference',
        project_id: null as any,
        scope: 'universal',
      } as any);
    }
  });

  afterEach(() => {
    storage.close();
  });

  it('returns ALL memories scoped to project A + universal — not top-5', () => {
    const all = storage.searchByContext({ project_id: 'project-a' });
    expect(all.length).toBe(20 + 3); // 20 in A + 3 universal
  });

  it('does not leak project B memories into project A enumeration', () => {
    const all = storage.searchByContext({ project_id: 'project-a' });
    const keys = all.map((m: any) => m.key);
    for (let i = 0; i < 5; i++) {
      expect(keys).not.toContain(`b-${i}`);
    }
  });

  it('returns all type categories — not just project-knowledge', () => {
    const all = storage.searchByContext({ project_id: 'project-a' });
    const types = new Set(all.map((m: any) => m.type));
    expect(types).toContain('preference');
    expect(types).toContain('correction');
    expect(types).toContain('failure');
    expect(types).toContain('devops');
    expect(types).toContain('project-knowledge');
  });

  it('type breakdown matches the actual stored counts', () => {
    const all = storage.searchByContext({ project_id: 'project-a' });
    const byType: Record<string, number> = {};
    for (const m of all) {
      byType[m.type] = (byType[m.type] || 0) + 1;
    }
    // 20 entries spread across 5 types = 4 each, plus 3 universal preference
    expect(byType.preference).toBe(4 + 3);
    expect(byType.correction).toBe(4);
    expect(byType.failure).toBe(4);
    expect(byType.devops).toBe(4);
    expect(byType['project-knowledge']).toBe(4);
  });
});
