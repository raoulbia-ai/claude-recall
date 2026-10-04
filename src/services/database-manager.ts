import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import { MemoryRetrieval } from '../core/retrieval';
import { Memory } from '../memory/storage';

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

      // 3. Prune outcome telemetry past its retention window
      removedCount += this.pruneTelemetry(db, config.retention.telemetryDays, dryRun);

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
      const rows = db.prepare(`
        SELECT id, access_count, cite_count, load_count, timestamp, last_accessed, type
        FROM memories WHERE type = ?
      `).all(type) as any[];

      if (rows.length <= keepCount) return 0;

      const scored = rows.map(r => ({
        id: r.id,
        strength: MemoryRetrieval.computeStrength(r as Memory),
      })).sort((a, b) => b.strength - a.strength);

      const toRemove = scored.slice(keepCount);

      if (!dryRun && toRemove.length > 0) {
        // Prepared-statement deletion. Previous code used string interpolation
        // of `id IN (${ids})` which was safe today (ids come from local
        // autoincrement INTEGER PKs) but would silently become a SQLi vector
        // if `id` ever became externally controlled. Audit 2026-04-23.
        const placeholders = toRemove.map(() => '?').join(',');
        db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
          .run(...toRemove.map(r => r.id));
      }

      this.logger.info('DatabaseManager', `Pruned ${toRemove.length} weak '${type}' memories (kept ${keepCount} strongest)`);
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
   * Prune outcome telemetry past the retention window.
   *
   * Age, not strength: these are append-only observations, one row per tool
   * result, and a month-old one teaches nothing. The tables are created lazily
   * by MemoryStorage, hence the existence check.
   */
  private pruneTelemetry(db: Database.Database, retentionDays: number, dryRun: boolean): number {
    if (retentionDays < 0) return 0; // Keep all

    try {
      const present = new Set(
        (db.prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table'
           AND name IN ('outcome_events', 'rule_injection_events', 'episodes')`
        ).all() as any[]).map(r => r.name)
      );
      if (present.size === 0) return 0;

      const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      const cutoffIso = new Date(cutoffMs).toISOString();
      let removed = 0;

      const sweep = (deleteSql: string, cutoff: string | number): void => {
        if (dryRun) {
          const countSql = deleteSql.replace('DELETE FROM', 'SELECT COUNT(*) AS c FROM');
          removed += (db.prepare(countSql).get(cutoff) as any).c as number;
        } else {
          removed += db.prepare(deleteSql).run(cutoff).changes;
        }
      };

      // created_at is ISO text; injected_at is epoch milliseconds.
      if (present.has('outcome_events')) {
        sweep('DELETE FROM outcome_events WHERE created_at < ?', cutoffIso);
      }
      if (present.has('rule_injection_events')) {
        sweep('DELETE FROM rule_injection_events WHERE injected_at < ?', cutoffMs);
      }
      // Unreferenced episodes only: `episode_id` has no foreign key, so an old
      // episode still owning fresh events would be orphaned, not blocked.
      if (present.has('episodes')) {
        const orphaned = present.has('outcome_events')
          ? `DELETE FROM episodes WHERE created_at < ?
             AND id NOT IN (SELECT episode_id FROM outcome_events WHERE episode_id IS NOT NULL)`
          : 'DELETE FROM episodes WHERE created_at < ?';
        sweep(orphaned, cutoffIso);
      }

      if (removed > 0) {
        this.logger.info('DatabaseManager', `Pruned ${removed} telemetry rows older than ${retentionDays} days`);
        if (!dryRun) console.error(`🔄 Pruned ${removed} telemetry rows older than ${retentionDays} days`);
      }
      return removed;

    } catch (error) {
      this.logger.error('DatabaseManager', 'Error pruning telemetry', error);
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