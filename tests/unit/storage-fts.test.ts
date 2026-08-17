import { MemoryStorage } from '../../src/memory/storage';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * FTS5 / BM25 retrieval path (CLAUDE_RECALL_RETRIEVAL=fts).
 *
 * retrievalMode is read from the environment in the constructor, so each test
 * sets the env var BEFORE `new MemoryStorage(...)`. Default-mode ('like')
 * behaviour is covered by storage.test.ts; here we assert the opt-in path.
 */
describe('MemoryStorage FTS5 retrieval', () => {
  const prev = process.env.CLAUDE_RECALL_RETRIEVAL;

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_RECALL_RETRIEVAL;
    else process.env.CLAUDE_RECALL_RETRIEVAL = prev;
  });

  function ftsStore(): MemoryStorage {
    process.env.CLAUDE_RECALL_RETRIEVAL = 'fts';
    return new MemoryStorage(':memory:');
  }

  it('returns keyword matches and attaches a normalized bm25Score in [0,1]', () => {
    const s = ftsStore();
    s.save({ key: 'k1', value: { content: 'use JWT authentication for the API' }, type: 'preference', project_id: 'p1' });
    s.save({ key: 'k2', value: { content: 'deploy via docker to production' }, type: 'devops', project_id: 'p1' });
    s.save({ key: 'k3', value: { content: 'prefer postgres over mysql' }, type: 'preference', project_id: 'p1' });

    const results = s.searchByContext({ project_id: 'p1', keywords: ['authentication'] });
    expect(results.map(r => r.key)).toContain('k1');
    expect(results.map(r => r.key)).not.toContain('k2');
    for (const r of results) {
      expect(r.bm25Score).toBeGreaterThanOrEqual(0);
      expect(r.bm25Score).toBeLessThanOrEqual(1);
    }
    // Best match in the set is normalized to exactly 1.
    expect(Math.max(...results.map(r => r.bm25Score ?? -1))).toBeCloseTo(1.0);
    s.close();
  });

  it('prefix-matches so a short keyword still hits a longer token (LIKE-substring parity)', () => {
    const s = ftsStore();
    s.save({ key: 'k1', value: { content: 'use JWT authentication for the API' }, type: 'preference', project_id: 'p1' });
    // "auth" must reach "authentication" via the prefix token, like LIKE '%auth%'.
    const results = s.searchByContext({ project_id: 'p1', keywords: ['auth'] });
    expect(results.map(r => r.key)).toContain('k1');
    s.close();
  });

  it('preserves scope: another project cannot see project-scoped rows; universal is shared', () => {
    const s = ftsStore();
    s.save({ key: 'a', value: { content: 'alpha rocket telemetry' }, type: 'preference', project_id: 'projA' });
    s.save({ key: 'u', value: { content: 'universal rocket rule' }, type: 'preference', project_id: 'projA', scope: 'universal' });

    const fromB = s.searchByContext({ project_id: 'projB', keywords: ['rocket'] });
    const keys = fromB.map(r => r.key);
    expect(keys).toContain('u');       // universal is visible everywhere
    expect(keys).not.toContain('a');   // projA-scoped is not
    s.close();
  });

  it('keeps the index in sync through update and delete (triggers)', () => {
    const s = ftsStore();
    s.save({ key: 'k1', value: { content: 'prefer postgres over mysql' }, type: 'preference', project_id: 'p1' });

    // Not matchable yet.
    expect(s.searchByContext({ project_id: 'p1', keywords: ['authentication'] }).map(r => r.key)).not.toContain('k1');

    // Re-save same key (upsert → AFTER UPDATE trigger) with new content.
    s.save({ key: 'k1', value: { content: 'prefer token authentication everywhere' }, type: 'preference', project_id: 'p1' });
    expect(s.searchByContext({ project_id: 'p1', keywords: ['authentication'] }).map(r => r.key)).toContain('k1');

    // Delete (AFTER DELETE trigger) removes it from the index.
    s.deleteByKey('k1');
    expect(s.searchByContext({ project_id: 'p1', keywords: ['authentication'] }).map(r => r.key)).not.toContain('k1');
    s.close();
  });

  it('does not crash on keywords that sanitize away to nothing', () => {
    const s = ftsStore();
    s.save({ key: 'k1', value: { content: 'plain memory content here' }, type: 'preference', project_id: 'p1' });
    // Punctuation-only / operator-like keywords must not throw; falls back to LIKE.
    expect(() => s.searchByContext({ project_id: 'p1', keywords: ['***', 'AND', '"('] })).not.toThrow();
    s.close();
  });

  it('backfills the index for a legacy DB that predates the FTS table (rebuild path)', () => {
    // A pre-0.38 DB: memories table + a row, but NO memories_fts table/triggers.
    const dbp = path.join(os.tmpdir(), `fts-legacy-test-${process.pid}-${Date.now()}.db`);
    const raw = new Database(dbp);
    raw.exec(
      'CREATE TABLE memories (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, ' +
      'value TEXT NOT NULL, type TEXT NOT NULL, project_id TEXT, file_path TEXT, timestamp INTEGER NOT NULL, ' +
      'access_count INTEGER DEFAULT 0, last_accessed INTEGER, relevance_score REAL DEFAULT 1.0, ' +
      'preference_key TEXT, is_active BOOLEAN DEFAULT 1, superseded_by TEXT, superseded_at INTEGER, ' +
      'confidence_score REAL, sophistication_level INTEGER DEFAULT 1, scope TEXT, content_hash TEXT)'
    );
    raw.prepare('INSERT INTO memories(key,value,type,project_id,timestamp) VALUES(?,?,?,?,?)')
      .run('legacy1', JSON.stringify({ content: 'ancient wisdom about terraform modules' }), 'devops', 'p1', Date.now());
    raw.close();

    try {
      process.env.CLAUDE_RECALL_RETRIEVAL = 'fts';
      const s = new MemoryStorage(dbp);
      // If the emptiness guard were wrong (count(*) proxies to content on an
      // external-content table), the backfill would be skipped and this misses.
      expect(s.searchByContext({ project_id: 'p1', keywords: ['terraform'] }).map(r => r.key)).toContain('legacy1');
      s.close();
    } finally {
      for (const ext of ['', '-wal', '-shm']) fs.rmSync(dbp + ext, { force: true });
    }
  });

  it('does not attach bm25Score on the default (like) path', () => {
    // Explicitly default mode.
    delete process.env.CLAUDE_RECALL_RETRIEVAL;
    const s = new MemoryStorage(':memory:');
    s.save({ key: 'k1', value: { content: 'use JWT authentication for the API' }, type: 'preference', project_id: 'p1' });
    const results = s.searchByContext({ project_id: 'p1', keywords: ['authentication'] });
    expect(results.map(r => r.key)).toContain('k1');
    expect(results.every(r => r.bm25Score === undefined)).toBe(true);
    s.close();
  });
});
