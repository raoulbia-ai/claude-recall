import { MemoryStorage } from '../../src/memory/storage';

/**
 * Unit tests for retroactive fuzzy dedup (MemoryStorage.dedupSimilar).
 * Write-time dedup is already tested elsewhere; this covers the catch-up pass
 * for rules that predate write-time dedup or slipped past its threshold.
 */

describe('MemoryStorage.dedupSimilar', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  function insert(params: {
    key: string;
    type: string;
    content: string;
    project_id?: string | null;
    timestamp?: number;
    cite_count?: number;
    load_count?: number;
  }): number {
    const db = storage.getDatabase();
    const result = db.prepare(`
      INSERT INTO memories (key, value, type, project_id, timestamp, is_active, cite_count, load_count)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      params.key,
      JSON.stringify({ content: params.content }),
      params.type,
      params.project_id ?? null,
      params.timestamp ?? Date.now(),
      params.cite_count ?? 0,
      params.load_count ?? 0,
    );
    return result.lastInsertRowid as number;
  }

  function row(id: number): {is_active: number; cite_count: number; load_count: number; superseded_by: string | null} {
    return storage.getDatabase()
      .prepare('SELECT is_active, cite_count, load_count, superseded_by FROM memories WHERE id = ?')
      .get(id) as any;
  }

  it('collapses three near-identical WSL install rules into the oldest', () => {
    // Real-world example: three variants of "installed globally in WSL" that
    // slipped past write-time dedup (created before it was added or tuned).
    const base = 1_775_759_000_000;
    const oldest = insert({
      key: 'wsl-oldest', type: 'devops', timestamp: base,
      content: 'claude-recall is installed globally in WSL (npm install -g claude-recall) to bypass Windows/WSL native-binary conflicts — do not attempt local node_modules installation',
      load_count: 194, cite_count: 0,
    });
    const mid = insert({
      key: 'wsl-mid', type: 'devops', timestamp: base + 300_000,
      content: 'Claude Recall is installed globally in WSL (npm install -g claude-recall) to work around Windows/WSL native-binary conflicts — do not attempt local installs in node_modules.',
      load_count: 192, cite_count: 0,
    });
    const newest = insert({
      key: 'wsl-newest', type: 'devops', timestamp: base + 600_000,
      content: "Claude Recall is installed globally in WSL via 'npm install -g claude-recall' to avoid Windows/WSL native-binary conflicts — avoid local node_modules installation for this tool.",
      load_count: 183, cite_count: 0,
    });

    const collapses = storage.dedupSimilar({ threshold: 0.65 });

    expect(collapses.length).toBe(2); // mid and newest both collapse into oldest
    for (const c of collapses) {
      expect(c.winnerId).toBe(oldest);
      expect([mid, newest]).toContain(c.loserId);
    }

    expect(row(oldest).is_active).toBe(1);
    expect(row(oldest).load_count).toBe(194 + 192 + 183); // summed into winner
    expect(row(mid).is_active).toBe(0);
    expect(row(mid).superseded_by).toBe('auto-dedup');
    expect(row(newest).is_active).toBe(0);
  });

  it('leaves distinct rules alone', () => {
    insert({ key: 'rule-a', type: 'devops', content: 'Always commit with --no-gpg-sign because the environment has no /dev/tty wired through' });
    insert({ key: 'rule-b', type: 'devops', content: 'Run npm run build before running tests after TypeScript edits to get latest compiled output' });
    insert({ key: 'rule-c', type: 'preference', content: 'Prefer terse responses with no trailing summaries so I can read the diff myself' });

    const collapses = storage.dedupSimilar({ threshold: 0.65 });

    expect(collapses).toHaveLength(0);
  });

  it('respects the similarity threshold', () => {
    const a = insert({
      key: 'a', type: 'devops', timestamp: 1,
      content: 'Before running integration tests make sure to run npm run build so the compiled output is fresh',
    });
    const b = insert({
      key: 'b', type: 'devops', timestamp: 2,
      content: 'Always run npm run build before running tests because TypeScript output needs to be current',
    });

    // Permissive threshold catches them
    const lenient = storage.dedupSimilar({ threshold: 0.3, dryRun: true });
    expect(lenient.length).toBeGreaterThan(0);

    // Strict threshold does not
    const strict = storage.dedupSimilar({ threshold: 0.9, dryRun: true });
    expect(strict.length).toBe(0);
  });

  it('never collapses across types', () => {
    insert({
      key: 'as-preference', type: 'preference', timestamp: 1,
      content: 'Use claude-recall installed globally in WSL to bypass native binary conflicts on windows',
    });
    insert({
      key: 'as-devops', type: 'devops', timestamp: 2,
      content: 'Use claude-recall installed globally in WSL to bypass native binary conflicts on windows',
    });

    const collapses = storage.dedupSimilar({ threshold: 0.65 });

    expect(collapses).toHaveLength(0);
  });

  it('never collapses across projects', () => {
    insert({
      key: 'in-project-a', type: 'devops', project_id: 'proj-a', timestamp: 1,
      content: 'Run npm run build after TypeScript edits before running tests to compile latest output',
    });
    insert({
      key: 'in-project-b', type: 'devops', project_id: 'proj-b', timestamp: 2,
      content: 'Run npm run build after TypeScript edits before running tests to compile latest output',
    });

    const collapses = storage.dedupSimilar({ threshold: 0.65 });

    expect(collapses).toHaveLength(0);
  });

  it('dry-run returns candidates without mutating', () => {
    const base = 1_000_000;
    const oldest = insert({
      key: 'dr-1', type: 'devops', timestamp: base,
      content: 'claude-recall is installed globally in WSL to avoid native binary conflicts on windows environments',
    });
    const newer = insert({
      key: 'dr-2', type: 'devops', timestamp: base + 100,
      content: 'claude-recall is installed globally in WSL to bypass native binary conflicts on windows platforms',
    });

    const collapses = storage.dedupSimilar({ threshold: 0.65, dryRun: true });

    expect(collapses.length).toBeGreaterThan(0);
    expect(row(oldest).is_active).toBe(1);
    expect(row(newer).is_active).toBe(1);
  });

  it('promoteRule restores auto-dedup losers', () => {
    const base = 1_000_000;
    insert({
      key: 'pr-oldest', type: 'devops', timestamp: base,
      content: 'claude-recall is installed globally in WSL to avoid native binary conflicts on windows environments',
    });
    const loser = insert({
      key: 'pr-loser', type: 'devops', timestamp: base + 100,
      content: 'claude-recall is installed globally in WSL to bypass native binary conflicts on windows platforms',
    });

    storage.dedupSimilar({ threshold: 0.65 });
    expect(row(loser).is_active).toBe(0);

    const ok = storage.promoteRule(loser);

    expect(ok).toBe(true);
    expect(row(loser).is_active).toBe(1);
  });
});
