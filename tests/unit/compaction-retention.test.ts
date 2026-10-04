import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseManager } from '../../src/services/database-manager';
import { ConfigService } from '../../src/services/config';

/**
 * Retention coverage for the types and tables that actually grow.
 *
 * Before this, compaction pruned 'tool-use' and 'correction' only, and ran
 * exclusively from the MCP server's boot path. A Pi-only host therefore never
 * compacted at all, and auto-captured failures plus outcome telemetry — by far
 * the largest writers — had no retention on any host.
 */
describe('compaction retention', () => {
  let dir: string;
  let dbPath: string;

  const schema = `
    CREATE TABLE memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT NOT NULL,
      type TEXT NOT NULL,
      project_id TEXT,
      timestamp INTEGER NOT NULL,
      access_count INTEGER DEFAULT 0,
      last_accessed INTEGER,
      relevance_score REAL DEFAULT 1.0,
      is_active BOOLEAN DEFAULT 1,
      load_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0
    );
    CREATE TABLE outcome_events (
      id TEXT PRIMARY KEY,
      episode_id TEXT,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      next_state_summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE rule_injection_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      injected_at INTEGER NOT NULL
    );
    CREATE TABLE episodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `;

  const daysAgo = (n: number) => Date.now() - n * 24 * 60 * 60 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();

  function seed(db: Database.Database): void {
    const mem = db.prepare(
      `INSERT INTO memories (key, value, type, timestamp, access_count, cite_count, load_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    // 10 failures: the 3 cited ones are the strongest and must survive a cap of 3.
    for (let i = 0; i < 10; i++) {
      const cited = i < 3 ? 5 : 0;
      mem.run(`fail-${i}`, JSON.stringify({ content: `Command failed: run ${i}` }), 'failure', daysAgo(i), cited, cited, 10);
    }
    mem.run('pref-1', JSON.stringify({ content: 'always use tabs' }), 'preference', daysAgo(40), 0, 0, 1);

    const ev = db.prepare(
      `INSERT INTO outcome_events (id, episode_id, event_type, actor, next_state_summary, created_at)
       VALUES (?, ?, 'tool_result', 'agent', 'ok', ?)`
    );
    ev.run('ev-old', 'ep-old', iso(daysAgo(40)));
    ev.run('ev-fresh', 'ep-live', iso(daysAgo(1)));

    const inj = db.prepare(
      `INSERT INTO rule_injection_events (rule_key, tool_name, injected_at) VALUES (?, 'pi:agent_turn', ?)`
    );
    inj.run('r-old', daysAgo(40));
    inj.run('r-fresh', daysAgo(1));

    const ep = db.prepare(`INSERT INTO episodes (id, project_id, started_at, created_at) VALUES (?, 'p', ?, ?)`);
    ep.run('ep-old', iso(daysAgo(40)), iso(daysAgo(40)));   // its only event is pruned too
    ep.run('ep-live', iso(daysAgo(40)), iso(daysAgo(40)));  // old, but still owns a fresh event
    ep.run('ep-orphan', iso(daysAgo(40)), iso(daysAgo(40))); // never had events
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-compaction-'));
    dbPath = path.join(dir, 'claude-recall.db');
    const db = new Database(dbPath);
    db.exec(schema);
    seed(db);
    db.close();

    (DatabaseManager as any).instance = undefined;
    jest.spyOn(ConfigService.prototype, 'getDatabasePath').mockReturnValue(dbPath);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (DatabaseManager as any).instance = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function configure(retention: Record<string, number>): void {
    jest.spyOn(ConfigService.prototype, 'getConfig').mockReturnValue({
      database: {
        compaction: {
          autoCompact: true,
          compactThreshold: 1, // any real file is over this
          maxMemories: 10000,
          retention,
        },
      },
      // LoggingService reads this in its constructor.
      logging: { directory: dir, level: 'error', maxFiles: 1, maxSize: '1MB' },
    } as any);
  }

  function rows(sql: string): any[] {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db.prepare(sql).all() as any[];
    } finally {
      db.close();
    }
  }

  it('prunes auto-captured failures to the cap, keeping the strongest', async () => {
    configure({ toolUse: -1, corrections: -1, failures: 3, telemetryDays: -1 });

    await DatabaseManager.getInstance().compact();

    const kept = rows(`SELECT key FROM memories WHERE type = 'failure'`).map(r => r.key);
    expect(kept).toHaveLength(3);
    expect(kept.sort()).toEqual(['fail-0', 'fail-1', 'fail-2']);
    // Other types are untouched by the failure cap.
    expect(rows(`SELECT key FROM memories WHERE type = 'preference'`)).toHaveLength(1);
  });

  it('prunes telemetry past the window but keeps episodes that still own events', async () => {
    configure({ toolUse: -1, corrections: -1, failures: -1, telemetryDays: 30 });

    await DatabaseManager.getInstance().compact();

    expect(rows('SELECT id FROM outcome_events').map(r => r.id)).toEqual(['ev-fresh']);
    expect(rows('SELECT rule_key FROM rule_injection_events').map(r => r.rule_key)).toEqual(['r-fresh']);
    // ep-live is older than the window, but pruning it would orphan ev-fresh.
    expect(rows('SELECT id FROM episodes').map(r => r.id)).toEqual(['ep-live']);
  });

  it('keeps everything when retention is disabled', async () => {
    configure({ toolUse: -1, corrections: -1, failures: -1, telemetryDays: -1 });

    await DatabaseManager.getInstance().compact();

    expect(rows(`SELECT id FROM memories WHERE type = 'failure'`)).toHaveLength(10);
    expect(rows('SELECT id FROM outcome_events')).toHaveLength(2);
    expect(rows('SELECT id FROM episodes')).toHaveLength(3);
  });

  it('falls back to defaults when a stored config predates the newer retention keys', async () => {
    // An undefined cap must not be read as "keep zero".
    configure({ toolUse: 1000, corrections: 100 } as any);

    await DatabaseManager.getInstance().compact();

    expect(rows(`SELECT id FROM memories WHERE type = 'failure'`)).toHaveLength(10);
  });

  describe('compactIfDue', () => {
    beforeEach(() => configure({ toolUse: -1, corrections: -1, failures: 3, telemetryDays: 30 }));

    it('runs when due and records the run', async () => {
      const result = await DatabaseManager.getInstance().compactIfDue();

      expect(result).not.toBeNull();
      expect(result!.removedCount).toBeGreaterThan(0);
      expect(fs.existsSync(path.join(dir, '.last-compaction'))).toBe(true);
    });

    it('does not run again within the interval', async () => {
      expect(await DatabaseManager.getInstance().compactIfDue()).not.toBeNull();
      expect(await DatabaseManager.getInstance().compactIfDue()).toBeNull();
    });

    it('runs again once the interval has passed', async () => {
      await DatabaseManager.getInstance().compactIfDue();
      const marker = path.join(dir, '.last-compaction');
      const old = daysAgo(2);
      fs.utimesSync(marker, old / 1000, old / 1000);

      expect(await DatabaseManager.getInstance().compactIfDue()).not.toBeNull();
    });

    it('stays quiet on a host that has never stored anything', async () => {
      fs.rmSync(dbPath);
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(DatabaseManager.getInstance().compactIfDue()).resolves.toBeNull();
      expect(fs.existsSync(path.join(dir, '.last-compaction'))).toBe(false);

      errors.mockRestore();
    });

    it('returns null instead of throwing when the database is unreadable', async () => {
      fs.rmSync(dbPath);

      await expect(DatabaseManager.getInstance().compactIfDue()).resolves.toBeNull();
    });
  });
});
