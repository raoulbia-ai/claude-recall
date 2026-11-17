import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { MemoryRetrieval } from '../core/retrieval';
import { Memory } from '../memory/storage';
import { pruneOutcomeData } from './outcome-storage';

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
    telemetryDays: number;
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
      telemetryDays: 30,
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
        retentionDays: config.retention.telemetryDays,
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
    
    // Copy database file
    fs.copyFileSync(dbPath, backupPath);
    
    // Clean up old backups (keep last 3)
    this.cleanupOldBackups(backupDir, 3);
    
    return backupPath;
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
   * Keys of memories the promotion engine wrote.
   *
   * The engine names them `promoted_*` and records the key on the lesson it
   * came from; both are checked, since an older promotion may predate either
   * convention on a given database.
   */
  private promotedKeys(db: Database.Database): Set<string> {
    try {
      const hasTable = db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_lessons'`
      ).get();
      if (!hasTable) return new Set();
      const rows = db.prepare(
        'SELECT promoted_memory_key AS k FROM candidate_lessons WHERE promoted_memory_key IS NOT NULL'
      ).all() as any[];
      return new Set(rows.map(r => r.k as string));
    } catch {
      return new Set();
    }
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
    if (keepCount < 0) return 0; // Keep all

    try {
      const columns = new Set(
        (db.prepare('PRAGMA table_info(memories)').all() as any[]).map(c => c.name)
      );
      const optional = ['is_active', 'confirmed_at'].filter(c => columns.has(c));
      const rows = db.prepare(`
        SELECT id, key, access_count, cite_count, load_count, timestamp, last_accessed, type${
          optional.length > 0 ? ', ' + optional.join(', ') : ''
        }
        FROM memories WHERE type = ?
      `).all(type) as any[];

      if (rows.length <= keepCount) return 0;

      // Rows this cap must never take. A confirmed rule and a promoted lesson
      // are the two things in here a human or the promotion engine deliberately
      // kept, and `DELETE` has no undo: a lesson earned over several sessions
      // would be silently spent to make room for raw capture.
      const promoted = this.promotedKeys(db);
      const isProtected = (r: any): boolean =>
        r.confirmed_at != null
        || typeof r.key === 'string' && (r.key.startsWith('promoted_') || promoted.has(r.key));

      const removable = rows.filter(r => !isProtected(r));
      // Inactive first — superseded or demoted rows are already out of every
      // retrieval path, so they cost the cap nothing to give up.
      const scored = removable.map(r => ({
        id: r.id,
        inactive: 'is_active' in r && (r.is_active === 0 || r.is_active === false) ? 0 : 1,
        strength: MemoryRetrieval.computeStrength(r as Memory),
      })).sort((a, b) => a.inactive - b.inactive || a.strength - b.strength);

      const toRemove = scored.slice(0, Math.min(rows.length - keepCount, scored.length));

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