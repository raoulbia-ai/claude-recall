import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { MemoryRetrieval } from '../core/retrieval';
import { Memory } from '../memory/storage';
import { pruneOutcomeData, telemetryRetentionDays } from './outcome-storage';
import { presentTables, tableColumns } from './sqlite-tables';

export interface CompactionConfig {
  autoCompact: boolean;
  compactThreshold: number;
  maxMemories: number;
  retention: {
    toolUse: number;
    corrections: number;
    preferences: number;
    projectKnowledge: number;
    failures: number;
  };
}

export interface CompactionResult {
  beforeSize: number;
  afterSize: number;
  removedCount: number;
  deduplicatedCount: number;
  duration: number;
  backupPath?: string;
}

export class DatabaseManager {
  private static instance: DatabaseManager;
  private config = ConfigService.getInstance();
  private logger = LoggingService.getInstance();
  
  private constructor() {
    this.logger.info('DatabaseManager', 'Initialized database manager');
  }
  
  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }
  
  private static readonly COMPACTION_DEFAULTS: CompactionConfig = {
    autoCompact: true,
    compactThreshold: 10 * 1024 * 1024, // 10MB
    maxMemories: 10000,
    retention: {
      toolUse: 1000,
      corrections: 100,
      preferences: -1, // Keep forever
      projectKnowledge: -1, // Keep forever
      failures: 1000,
    },
  };

  /** Shortest gap between two automatic compactions. */
  private static readonly DEFAULT_COMPACTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

  /**
   * Compact if the thresholds say so and the last run is old enough.
   *
   * The throttle matters: `compactThreshold` defaults to 10MB, so most working
   * databases are always over it, and compaction copies a backup and VACUUMs.
   * Returns null when nothing ran; never throws.
   */
  async compactIfDue(minIntervalMs: number = DatabaseManager.DEFAULT_COMPACTION_INTERVAL_MS): Promise<CompactionResult | null> {
    try {
      const dbPath = this.config.getDatabasePath();
      // A host that has never stored anything has nothing to compact, and
      // shouldCompact() would stat a missing file and log the ENOENT as an error.
      if (!fs.existsSync(dbPath)) return null;

      const marker = path.join(path.dirname(dbPath), '.last-compaction');
      const lastRun = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : 0;
      if (Date.now() - lastRun < minIntervalMs) return null;

      if (!(await this.shouldCompact())) return null;

      const result = await this.compact();
      fs.writeFileSync(marker, new Date().toISOString());
      return result;
    } catch (error) {
      this.logger.error('DatabaseManager', 'Automatic compaction failed', error);
      return null;
    }
  }

  /**
   * Check if compaction is needed based on thresholds
   */
  async shouldCompact(): Promise<boolean> {
    const dbPath = this.config.getDatabasePath();
    const config = this.getCompactionConfig();
    
    if (!config.autoCompact) {
      return false;
    }
    
    try {
      const stats = fs.statSync(dbPath);
      const sizeInBytes = stats.size;
      
      // Check size threshold
      if (sizeInBytes > config.compactThreshold) {
        this.logger.info('DatabaseManager', `Database size (${sizeInBytes} bytes) exceeds threshold (${config.compactThreshold} bytes)`);
        return true;
      }
      
      // Check memory count threshold
      const db = new Database(dbPath, { readonly: true });
      const countResult = db.prepare('SELECT COUNT(*) as count FROM memories').get() as any;
      db.close();
      
      if (countResult.count > config.maxMemories) {
        this.logger.info('DatabaseManager', `Memory count (${countResult.count}) exceeds threshold (${config.maxMemories})`);
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.error('DatabaseManager', 'Error checking compaction need', error);
      return false;
    }
  }
  
  /**
   * Perform database compaction
   */
  async compact(dryRun: boolean = false): Promise<CompactionResult> {
    const startTime = Date.now();
    const dbPath = this.config.getDatabasePath();
    const config = this.getCompactionConfig();
    
    // Get initial size
    const beforeStats = fs.statSync(dbPath);
    const beforeSize = beforeStats.size;
    
    let backupPath: string | undefined;
    let removedCount = 0;
    let deduplicatedCount: number;

    try {
      // VACUUM rewrites every page of the file. Running it over a B-tree that is
      // already damaged turns a partial loss into a total one — and on 2026-11-09
      // compaction did exactly that, start to finish, on a database SQLite was
      // already calling malformed. Check first, refuse early, and leave the file
      // untouched for recovery.
      const health = this.integrityVerdict(dbPath);
      if (health !== 'ok') {
        this.logger.error('DatabaseManager', `Skipping compaction: integrity check failed (${health})`);
        console.error(`⚠️  Skipping compaction — integrity check failed: ${health}`);
        console.error('   Recover the database before compacting; the file was left untouched.');
        throw new Error(`Database failed integrity check: ${health}`);
      }

      // Create backup if not dry run
      if (!dryRun) {
        backupPath = await this.createBackup();
        this.logger.info('DatabaseManager', `Created backup at ${backupPath}`);
        console.error(`🔄 Created backup at ${backupPath}`);
      }
      
      const db = new Database(dbPath, { readonly: dryRun });
      
      if (!dryRun) {
        db.pragma('journal_mode = WAL');
      }
      
      // 1. Deduplicate identical memories
      const dedupeResult = this.deduplicateMemories(db, dryRun);
      deduplicatedCount = dedupeResult;
      
      // 2. Prune memory types that grow without bound, strongest kept
      removedCount += this.pruneByType(db, 'tool-use', config.retention.toolUse, dryRun);
      removedCount += this.pruneByType(db, 'correction', config.retention.corrections, dryRun);
      removedCount += this.pruneByType(db, 'failure', config.retention.failures, dryRun);

      // 3. Prune the outcome tables past their retention window — the same
      //    pass the hooks run, so there is one window, not two.
      const pruned = pruneOutcomeData(db, {
        retentionDays: telemetryRetentionDays(),
        dryRun,
      });
      const prunedRows = pruned.episodes + pruned.events + pruned.injections
        + pruned.lessons + pruned.stats;
      if (prunedRows > 0) {
        removedCount += prunedRows;
        this.logger.info('DatabaseManager', `Pruned ${prunedRows} outcome rows`, pruned);
        if (!dryRun) console.error(`🔄 Pruned ${prunedRows} outcome rows`);
      }

      // 4. Run VACUUM to reclaim space (only if not dry run)
      if (!dryRun) {
        this.logger.info('DatabaseManager', 'Running VACUUM to reclaim space...');
        console.error('🗜️  Compacting database...');
        db.exec('VACUUM');
      }
      
      db.close();
      
      // Get final size
      const afterStats = fs.statSync(dbPath);
      const afterSize = afterStats.size;
      
      const result: CompactionResult = {
        beforeSize,
        afterSize,
        removedCount,
        deduplicatedCount,
        duration: Date.now() - startTime,
        backupPath
      };
      
      // Log results
      const savedBytes = beforeSize - afterSize;
      const savedMB = (savedBytes / 1024 / 1024).toFixed(2);
      this.logger.info('DatabaseManager', `Compaction ${dryRun ? '(dry run) ' : ''}completed`, {
        removedCount,
        deduplicatedCount,
        savedMB,
        duration: `${result.duration}ms`
      });
      
      if (!dryRun && savedBytes > 0) {
        console.error(`✅ Database compacted, saved ${savedMB}MB`);
      }
      
      return result;
      
    } catch (error) {
      this.logger.error('DatabaseManager', 'Error during compaction', error);
      throw error;
    }
  }
  
  /**
   * Create a backup of the database
   */
  private async createBackup(): Promise<string> {
    const dbPath = this.config.getDatabasePath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(path.dirname(dbPath), '.claude-recall-backups');
    
    // Create backup directory if it doesn't exist
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const backupPath = path.join(backupDir, `claude-recall-${timestamp}.db`);

    // `fs.copyFileSync` was wrong twice over, and a 2026-11-09 corruption proved
    // both halves on a live database. (1) In WAL mode the committed tail lives in
    // the -wal file, which the copy never touched, so a "backup" was the database
    // minus its most recent transactions. (2) Other agent processes write while
    // the copy runs: a plain byte copy of a moving file is a torn image, not a
    // snapshot. All three retained backups were unreadable in exactly the same
    // pages as the database they were supposed to rescue.
    //
    // `VACUUM INTO` takes a consistent snapshot through SQLite itself: it reads a
    // single committed view (WAL included) under proper locking and writes a
    // fresh, defragmented database. Available since SQLite 3.27 (2019); older
    // engines fall back to the online backup API, which is also snapshot-correct.
    const source = new Database(dbPath, { readonly: true });
    try {
      try {
        source.exec(`VACUUM INTO ${this.quoteSqlString(backupPath)}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/near "INTO"|syntax error/i.test(message)) throw error;
        this.logger.info('DatabaseManager', 'VACUUM INTO unavailable, using the online backup API');
        await (source as any).backup(backupPath);
      }
    } finally {
      source.close();
    }

    // `copyFileSync` carried the source permissions along; `VACUUM INTO` creates
    // a new file under the process umask, which on a default umask is 0644. That
    // would quietly undo owner-only access for a file holding every rule and
    // secret the agent has learned, so the mode is copied from the database
    // explicitly rather than left to the environment.
    try {
      fs.chmodSync(backupPath, fs.statSync(dbPath).mode & 0o777);
    } catch (error) {
      this.logger.error('DatabaseManager', 'Could not match backup permissions to the database', error);
    }

    // A backup nobody verified is a guess. Reading it back costs milliseconds and
    // is the only thing that distinguishes a restore point from a copy of the
    // damage — and it must happen BEFORE rotation, or a corrupt new file silently
    // evicts the last good one (which is how the 2026-11-09 incident ran out of
    // clean copies: keep-3, all three written after the damage).
    const verdict = this.integrityVerdict(backupPath);
    if (verdict !== 'ok') {
      this.logger.error('DatabaseManager', `Backup failed integrity check: ${verdict}`);
      try { fs.unlinkSync(backupPath); } catch { /* best effort */ }
      throw new Error(`Refusing to keep an unverifiable backup (${verdict}); existing backups left untouched`);
    }

    // Clean up old backups (keep last 3) — only now that the new one is known good
    this.cleanupOldBackups(backupDir, 3);
    
    return backupPath;
  }

  /**
   * `PRAGMA integrity_check` reduced to a single verdict: 'ok', or the first
   * problem reported. Used to gate both backup rotation and VACUUM.
   */
  private integrityVerdict(dbPath: string): string {
    let db: Database.Database | undefined;
    try {
      db = new Database(dbPath, { readonly: true });
      const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      const first = rows?.[0]?.integrity_check ?? 'no result';
      return first === 'ok' ? 'ok' : first;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      try { db?.close(); } catch { /* best effort */ }
    }
  }

  /** Single-quoted SQL string literal (VACUUM INTO takes no bound parameters). */
  private quoteSqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }
  
  /**
   * Clean up old backup files
   */
  private cleanupOldBackups(backupDir: string, keepCount: number): void {
    try {
      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('claude-recall-') && f.endsWith('.db'))
        .map(f => ({
          name: f,
          path: path.join(backupDir, f),
          mtime: fs.statSync(path.join(backupDir, f)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
      
      // Remove old backups
      for (let i = keepCount; i < files.length; i++) {
        fs.unlinkSync(files[i].path);
        this.logger.info('DatabaseManager', `Removed old backup: ${files[i].name}`);
      }
    } catch (error) {
      this.logger.error('DatabaseManager', 'Error cleaning up old backups', error);
    }
  }
  
  /**
   * Deduplicate identical memories
   */
  private deduplicateMemories(db: Database.Database, dryRun: boolean): number {
    try {
      let totalRemoved = 0;

      // Content-hash dedup, scoped per project: two projects may legitimately
      // hold identical content (e.g. task checkpoints), so grouping must never
      // collapse across project_id. Winner selection prefers ACTIVE rows —
      // keeping min(id) unconditionally could delete the active row and leave
      // a superseded one, silently dropping the rule from loadActiveRules.
      // Counters merge into the winner so demotion/sync signals survive.
      // (No legacy content_hash IS NULL fallback: the migration backfills
      // every row, and `key` is UNIQUE so a (type,key,value) group can never
      // exceed one row anyway.)
      const hashDuplicates = db.prepare(`
        SELECT content_hash, COALESCE(project_id, '') as pid, GROUP_CONCAT(id) as ids
        FROM memories
        WHERE content_hash IS NOT NULL
        GROUP BY content_hash, COALESCE(project_id, '')
        HAVING COUNT(*) > 1
      `).all() as any[];

      const rowStmt = db.prepare(
        'SELECT id, is_active, load_count, cite_count, access_count FROM memories WHERE id = ?'
      );

      for (const dup of hashDuplicates) {
        const ids: number[] = dup.ids.split(',').map((id: string) => parseInt(id, 10));
        const rows = ids.map(id => rowStmt.get(id) as any).filter(Boolean);
        // Prefer active rows as winner; among equals keep the oldest id
        rows.sort((a, b) => ((b.is_active ?? 0) - (a.is_active ?? 0)) || (a.id - b.id));
        const winner = rows[0];
        const losers = rows.slice(1);

        if (!dryRun && losers.length > 0) {
          const loadSum = losers.reduce((s, r) => s + (r.load_count || 0), 0);
          const citeSum = losers.reduce((s, r) => s + (r.cite_count || 0), 0);
          const accessSum = losers.reduce((s, r) => s + (r.access_count || 0), 0);
          db.prepare(
            'UPDATE memories SET load_count = load_count + ?, cite_count = cite_count + ?, access_count = access_count + ? WHERE id = ?'
          ).run(loadSum, citeSum, accessSum, winner.id);
          const del = db.prepare('DELETE FROM memories WHERE id = ?');
          for (const r of losers) {
            del.run(r.id);
          }
        }

        totalRemoved += losers.length;
      }

      this.logger.info('DatabaseManager', `Deduplicated ${totalRemoved} memories`);
      if (totalRemoved > 0 && !dryRun) {
        // stderr — this can run inside the MCP server, stdout is JSON-RPC
        console.error(`🔄 Deduplicated ${totalRemoved} identical memories`);
      }
      return totalRemoved;

    } catch (error) {
      this.logger.error('DatabaseManager', 'Error deduplicating memories', error);
      return 0;
    }
  }
  
  /**
   * Rows a retention cap must never take.
   *
   * A confirmed rule and a promoted lesson are the two things in the store a
   * human or the promotion engine deliberately kept, and `DELETE` has no undo:
   * a lesson earned over several sessions would otherwise be spent to make
   * room for raw capture, which is stored under the same type.
   *
   * The engine names promotions `promoted_*` and records the key on the lesson
   * they came from; both are checked, since a promotion may predate either
   * convention on a given database.
   */
  private capExemption(db: Database.Database): (row: any) => boolean {
    let promoted = new Set<string>();
    if (presentTables(db, ['candidate_lessons']).has('candidate_lessons')) {
      try {
        const rows = db.prepare(
          'SELECT promoted_memory_key AS k FROM candidate_lessons WHERE promoted_memory_key IS NOT NULL'
        ).all() as { k: string }[];
        promoted = new Set(rows.map(r => r.k));
      } catch { /* unreadable lesson table — fall back to the name convention */ }
    }

    return row => row.confirmed_at != null
      || (typeof row.key === 'string' && (row.key.startsWith('promoted_') || promoted.has(row.key)));
  }

  /**
   * Prune one memory type down to its retention cap, keeping the strongest.
   *
   * `correction` targets type = 'correction', what production actually writes:
   * an earlier implementation targeted 'correction-pattern' with a
   * preference_key requirement, which nothing ever wrote, so that retention
   * had never fired.
   */
  private pruneByType(db: Database.Database, type: string, keepCount: number, dryRun: boolean): number {
    // -1 keeps all. So does a cap that did not parse: NaN must never reach the
    // slice below, where it would read as zero.
    if (!(keepCount >= 0)) return 0;

    try {
      const columns = tableColumns(db, 'memories');
      const optional = ['is_active', 'confirmed_at'].filter(c => columns.has(c));
      const rows = db.prepare(`
        SELECT id, key, access_count, cite_count, load_count, timestamp, last_accessed, type${
          optional.length > 0 ? ', ' + optional.join(', ') : ''
        }
        FROM memories WHERE type = ?
      `).all(type) as any[];

      if (rows.length <= keepCount) return 0;

      const isExempt = this.capExemption(db);
      const removable = rows.filter(r => !isExempt(r));
      // Inactive first — superseded or demoted rows are already out of every
      // retrieval path, so they cost the cap nothing to give up.
      const scored = removable.map(r => ({
        id: r.id,
        inactive: r.is_active === 0 || r.is_active === false ? 0 : 1,
        strength: MemoryRetrieval.computeStrength(r as Memory),
      })).sort((a, b) => a.inactive - b.inactive || a.strength - b.strength);

      const toRemove = scored.slice(0, rows.length - keepCount);

      if (!dryRun && toRemove.length > 0) {
        // Prepared-statement deletion. Previous code used string interpolation
        // of `id IN (${ids})` which was safe today (ids come from local
        // autoincrement INTEGER PKs) but would silently become a SQLi vector
        // if `id` ever became externally controlled. Audit 2026-04-23.
        const placeholders = toRemove.map(() => '?').join(',');
        db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
          .run(...toRemove.map(r => r.id));
      }

      this.logger.info(
        'DatabaseManager',
        `Pruned ${toRemove.length} weak '${type}' memories (kept ${rows.length - toRemove.length}, `
        + `${rows.length - removable.length} protected as confirmed or promoted)`,
      );
      if (toRemove.length > 0 && !dryRun) {
        // stderr — this can run inside the MCP server, stdout is JSON-RPC
        console.error(`🔄 Pruned ${toRemove.length} weak ${type} memories`);
      }
      return toRemove.length;

    } catch (error) {
      this.logger.error('DatabaseManager', `Error pruning '${type}' memories`, error);
      return 0;
    }
  }

  
  /**
   * Get compaction configuration
   */
  private getCompactionConfig(): CompactionConfig {
    const stored = (this.config.getConfig() as any).database?.compaction;

    // Merge, not replace: an older config file has a `compaction` block without
    // the newer keys, and an undefined cap would make `slice(keepCount)` select
    // every row for deletion.
    return {
      ...DatabaseManager.COMPACTION_DEFAULTS,
      ...stored,
      retention: {
        ...DatabaseManager.COMPACTION_DEFAULTS.retention,
        ...stored?.retention,
      },
    };
  }
  
  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    sizeBytes: number;
    sizeMB: number;
    totalMemories: number;
    memoryTypes: Record<string, number>;
  }> {
    const dbPath = this.config.getDatabasePath();
    const stats = fs.statSync(dbPath);
    
    const db = new Database(dbPath, { readonly: true });
    
    const totalResult = db.prepare('SELECT COUNT(*) as count FROM memories').get() as any;
    const typeResults = db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type').all() as any[];
    
    db.close();
    
    const memoryTypes: Record<string, number> = {};
    for (const result of typeResults) {
      memoryTypes[result.type] = result.count;
    }
    
    return {
      sizeBytes: stats.size,
      sizeMB: stats.size / (1024 * 1024),
      totalMemories: totalResult.count,
      memoryTypes
    };
  }
  
  /**
   * Close database connections
   * Note: This is a no-op as DatabaseManager doesn't maintain persistent connections
   */
  close(): void {
    // DatabaseManager doesn't maintain persistent database connections
    // Each operation opens and closes its own connection
    // This method exists for API compatibility with tests
    this.logger.info('DatabaseManager', 'Close called (no-op - connections are per-operation)');
  }
}