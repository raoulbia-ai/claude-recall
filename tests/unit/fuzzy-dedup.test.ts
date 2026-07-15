import { MemoryStorage } from '../../src/memory/storage';

/**
 * Fix A — Fuzzy dedup at write time.
 *
 * Pre-fix bug: computeContentHash uses exact SHA-256 of type + canonical JSON.
 * Three phrasings of the same devops rule (e.g., "Claude Recall is installed
 * globally in WSL") have slightly different wording → different hashes → all
 * stored. The Jaccard fuzzy dedup in shared.ts is only used by the
 * tool-outcome-watcher for failures, never at the general write path.
 *
 * Post-fix contract:
 *   - storage.save() checks Jaccard similarity against same-type memories
 *     when exact-hash dedup doesn't match.
 *   - If a same-type memory has Jaccard >= 0.65 (stop-word-filtered), the new insert is skipped
 *     (existing memory's timestamp is bumped instead).
 *   - Memories of different types are never fuzzy-deduped against each other.
 *   - Sufficiently different content (Jaccard < 0.85) is stored normally.
 */
describe('fuzzy dedup at write time', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });

  test('blocks near-duplicate same-type memory (Jaccard >= 0.85)', () => {
    // Original
    storage.save({
      key: 'devops-1',
      value: { content: 'Claude Recall is installed globally in WSL (npm install -g claude-recall) to work around Windows/WSL native-binary conflicts — do not attempt local installs in node_modules.' },
      type: 'devops',
      project_id: 'proj-a',
    });

    // Near-duplicate with minor wording difference
    storage.save({
      key: 'devops-2',
      value: { content: 'claude-recall is installed globally in WSL (npm install -g claude-recall) to bypass Windows/WSL native-binary conflicts — do not attempt local node_modules installation' },
      type: 'devops',
      project_id: 'proj-a',
    });

    // Third variant
    storage.save({
      key: 'devops-3',
      value: { content: "Claude Recall is installed globally in WSL via 'npm install -g claude-recall' to avoid Windows/WSL native-binary conflicts — avoid local node_modules installation for this tool." },
      type: 'devops',
      project_id: 'proj-a',
    });

    const all = storage.searchByContext({ project_id: 'proj-a' });
    // Should only have 1 memory, not 3
    const devopsMemories = all.filter(m => m.type === 'devops');
    expect(devopsMemories).toHaveLength(1);
  });

  test('allows sufficiently different same-type memories', () => {
    storage.save({
      key: 'devops-1',
      value: { content: 'Claude Recall is installed globally in WSL to avoid native-binary conflicts' },
      type: 'devops',
      project_id: 'proj-a',
    });

    storage.save({
      key: 'devops-2',
      value: { content: 'npm run build must run after TypeScript edits before running tests — tsc compilation is required' },
      type: 'devops',
      project_id: 'proj-a',
    });

    const all = storage.searchByContext({ project_id: 'proj-a' });
    const devopsMemories = all.filter(m => m.type === 'devops');
    expect(devopsMemories).toHaveLength(2);
  });

  test('does not fuzzy-dedup across different types', () => {
    const content = 'Claude Recall is installed globally in WSL to avoid native-binary conflicts';

    storage.save({
      key: 'devops-1',
      value: { content },
      type: 'devops',
      project_id: 'proj-a',
    });

    storage.save({
      key: 'pref-1',
      value: { content },
      type: 'preference',
      project_id: 'proj-a',
    });

    const all = storage.searchByContext({ project_id: 'proj-a' });
    expect(all).toHaveLength(2);
    expect(all.map(m => m.type).sort()).toEqual(['devops', 'preference']);
  });

  test('bumps existing memory timestamp on fuzzy dedup skip', () => {
    storage.save({
      key: 'devops-1',
      value: { content: 'Claude Recall is installed globally in WSL (npm install -g claude-recall) to work around Windows/WSL native-binary conflicts' },
      type: 'devops',
      project_id: 'proj-a',
    });

    const before = storage.searchByContext({ project_id: 'proj-a' })[0];
    const originalTimestamp = before.timestamp!;

    // Small delay then save near-duplicate
    const laterTimestamp = Date.now() + 1000;
    jest.spyOn(Date, 'now').mockReturnValue(laterTimestamp);

    storage.save({
      key: 'devops-2',
      value: { content: 'claude-recall is installed globally in WSL (npm install -g claude-recall) to bypass Windows/WSL native-binary conflicts' },
      type: 'devops',
      project_id: 'proj-a',
    });

    jest.restoreAllMocks();

    const after = storage.searchByContext({ project_id: 'proj-a' });
    expect(after).toHaveLength(1);
    // Timestamp should have been bumped
    expect(after[0].timestamp!).toBeGreaterThanOrEqual(originalTimestamp);
  });

  /**
   * Newest-wins supersession (opt-in via save(..., {fuzzyNewestWins: true})):
   * a user restating a rule precisely must not have the new phrasing absorbed
   * into the old vague row — the NEW text wins and the old row is superseded
   * by key (not revivable — replaced, not judged noise).
   */
  describe('fuzzyNewestWins', () => {
    const OLD_TEXT = 'Email text files should start with the email prefix when created';
    const NEW_TEXT = 'Email text files should start with the email_ prefix when created in any directory';

    function seedOld() {
      storage.save({
        key: 'pref-old',
        value: { content: OLD_TEXT },
        type: 'preference',
        project_id: 'proj-a',
      });
      // Simulate accumulated compliance history
      const oldRow = storage.searchByContext({ project_id: 'proj-a' })[0];
      storage.incrementLoadCounts([oldRow.id!]);
      storage.incrementLoadCounts([oldRow.id!]);
    }

    test('the new phrasing supersedes the fuzzy-matched old row', () => {
      seedOld();
      storage.save({
        key: 'pref-new',
        value: { content: NEW_TEXT },
        type: 'preference',
        project_id: 'proj-a',
      }, { fuzzyNewestWins: true });

      const all = storage.searchByContext({ project_id: 'proj-a' });
      const oldRow = all.find(m => m.key === 'pref-old')!;
      const newRow = all.find(m => m.key === 'pref-new')!;

      expect(newRow).toBeDefined();
      expect(newRow.is_active).toBeTruthy();
      expect((newRow.value as any).content).toBe(NEW_TEXT);
      expect(oldRow.is_active).toBeFalsy();
      expect(oldRow.superseded_by).toBe('pref-new');
    });

    test('compliance counters carry over to the winning row', () => {
      seedOld();
      storage.save({
        key: 'pref-new',
        value: { content: NEW_TEXT },
        type: 'preference',
        project_id: 'proj-a',
      }, { fuzzyNewestWins: true });

      const newRow = storage.searchByContext({ project_id: 'proj-a' })
        .find(m => m.key === 'pref-new')!;
      expect(newRow.load_count).toBe(2);
    });

    test('a key-superseded row is NOT revivable via promoteRule', () => {
      seedOld();
      storage.save({
        key: 'pref-new',
        value: { content: NEW_TEXT },
        type: 'preference',
        project_id: 'proj-a',
      }, { fuzzyNewestWins: true });

      const oldRow = storage.searchByContext({ project_id: 'proj-a' })
        .find(m => m.key === 'pref-old')!;
      expect(storage.promoteRule(oldRow.id!)).toBe(false);
    });

    test('without the flag, the old row still wins (default behavior unchanged)', () => {
      seedOld();
      storage.save({
        key: 'pref-new',
        value: { content: NEW_TEXT },
        type: 'preference',
        project_id: 'proj-a',
      });

      const all = storage.searchByContext({ project_id: 'proj-a' });
      expect(all.find(m => m.key === 'pref-new')).toBeUndefined();
      expect(all.find(m => m.key === 'pref-old')!.is_active).toBeTruthy();
    });

    test('exact-content duplicates still dedup (hash path runs before newest-wins)', () => {
      seedOld();
      storage.save({
        key: 'pref-dup',
        value: { content: OLD_TEXT },
        type: 'preference',
        project_id: 'proj-a',
      }, { fuzzyNewestWins: true });

      const all = storage.searchByContext({ project_id: 'proj-a' });
      expect(all.find(m => m.key === 'pref-dup')).toBeUndefined();
      expect(all.find(m => m.key === 'pref-old')!.is_active).toBeTruthy();
    });
  });
});
