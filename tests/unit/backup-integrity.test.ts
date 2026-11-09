import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DatabaseManager } from '../../src/services/database-manager';
import { ConfigService } from '../../src/services/config';

/**
 * Backups that survive WAL, and compaction that refuses damaged files.
 *
 * On 2026-11-09 a shared database went malformed. Recovery found that every
 * retained backup was unreadable in the same pages as the database itself, so
 * there was nothing to restore from. Two causes, both reproduced here:
 *
 *   1. backups were `fs.copyFileSync` of the .db file alone. In WAL mode the
 *      committed tail lives in the -wal file, so the copy was the database
 *      minus its newest transactions — and torn, because other processes were
 *      writing during the copy.
 *   2. compaction VACUUMed a database SQLite already called malformed, and the
 *      fresh (corrupt) backups then evicted the last clean ones under keep-3.
 */
describe('backup integrity', () => {
  let dir: string;
  let dbPath: string;
  let backupDir: string;

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

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-backup-'));
    dbPath = path.join(dir, 'claude-recall.db');
    backupDir = path.join(dir, '.claude-recall-backups');

    const db = new Database(dbPath);
    db.exec(schema);
    db.close();

    (DatabaseManager as any).instance = undefined;
    jest.spyOn(ConfigService.prototype, 'getDatabasePath').mockReturnValue(dbPath);
    jest.spyOn(ConfigService.prototype, 'getConfig').mockReturnValue({
      database: {
        compaction: {
          autoCompact: true,
          compactThreshold: 1, // any real file is over this
          maxMemories: 10000,
          retention: { toolUse: -1, corrections: -1, failures: -1, telemetryDays: -1 },
        },
      },
      logging: { directory: dir, level: 'error', maxFiles: 1, maxSize: '1MB' },
    } as any);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (DatabaseManager as any).instance = undefined;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const backups = (): string[] =>
    fs.existsSync(backupDir)
      ? fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).sort()
      : [];

  it('captures rows that are still only in the -wal file', async () => {
    // A live writer, WAL not checkpointed: this row exists for every reader of
    // the database, but not one byte of it is in the .db file yet.
    const live = new Database(dbPath);
    live.pragma('journal_mode = WAL');
    live.prepare(
      `INSERT INTO memories (key, value, type, timestamp) VALUES ('wal-only', '{"content":"in the wal"}', 'preference', ?)`
    ).run(Date.now());

    try {
      expect(fs.readFileSync(dbPath).includes(Buffer.from('in the wal'))).toBe(false); // precondition
      await DatabaseManager.getInstance().compact();

      const made = backups();
      expect(made).toHaveLength(1);

      const copy = new Database(path.join(backupDir, made[0]), { readonly: true });
      try {
        const row = copy.prepare(`SELECT value FROM memories WHERE key = 'wal-only'`).get() as any;
        expect(row?.value).toContain('in the wal');
      } finally {
        copy.close();
      }
    } finally {
      live.close();
    }
  });

  it('refuses to compact a malformed database and leaves the file untouched', async () => {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO memories (key, value, type, timestamp) VALUES ('before', '{"content":"x"}', 'preference', ?)`
    ).run(Date.now());
    db.close();

    // Shred a page in the middle: enough for integrity_check to object, while
    // the header stays valid so the file still opens.
    const bytes = fs.readFileSync(dbPath);
    bytes.fill(0x5a, 4096, 4096 + 512);
    fs.writeFileSync(dbPath, bytes);
    const before = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');

    await expect(DatabaseManager.getInstance().compact()).rejects.toThrow(/integrity check/i);

    const after = crypto.createHash('sha256').update(fs.readFileSync(dbPath)).digest('hex');
    expect(after).toBe(before);       // VACUUM never ran on the damaged file
    expect(backups()).toHaveLength(0); // and no copy of the damage was retained
  });

  it('does not widen permissions beyond the database it copies', async () => {
    // The database is owner-only; a backup of it holds exactly the same rules and
    // secrets. `VACUUM INTO` creates a fresh file under the umask, so without an
    // explicit chmod a default umask publishes it as 0644.
    fs.chmodSync(dbPath, 0o600);

    await DatabaseManager.getInstance().compact();

    const made = backups();
    expect(made).toHaveLength(1);
    const mode = fs.statSync(path.join(backupDir, made[0])).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('keeps the previous backups when the new one cannot be verified', async () => {
    fs.mkdirSync(backupDir, { recursive: true });
    const keeper = path.join(backupDir, 'claude-recall-known-good.db');
    fs.copyFileSync(dbPath, keeper);

    const manager = DatabaseManager.getInstance() as any;
    jest.spyOn(manager, 'integrityVerdict').mockReturnValue('*** in database main *** page 7 is never used');

    await expect(manager.createBackup()).rejects.toThrow(/unverifiable backup/i);
    expect(fs.existsSync(keeper)).toBe(true);
    expect(backups()).toEqual(['claude-recall-known-good.db']);
  });
});
