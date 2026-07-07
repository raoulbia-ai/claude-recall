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
      
      // 2. Prune old tool-use memories
      const toolUseResult = this.pruneOldToolUse(db, config.retention.toolUse, dryRun);
      removedCount += toolUseResult;
      
      // 3. Prune old corrections
      const correctionsResult = this.pruneOldCorrections(db, config.retention.corrections, dryRun);
      removedCount += correctionsResult;
      
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
   * Prune old tool-use memories
   */
  private pruneOldToolUse(db: Database.Database, keepCount: number, dryRun: boolean): number {
    if (keepCount < 0) return 0; // Keep all

    try {
      // Fetch all tool-use memories, compute strength, keep the strongest
      const rows = db.prepare(`
        SELECT id, access_count, cite_count, load_count, timestamp, last_accessed, type
        FROM memories WHERE type = 'tool-use'
      `).all() as any[];

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

      this.logger.info('DatabaseManager', `Pruned ${toRemove.length} old tool-use memories (kept ${keepCount} strongest)`);
      if (toRemove.length > 0 && !dryRun) {
        console.error(`🔄 Pruned ${toRemove.length} weak tool-use memories`);
      }
      return toRemove.length;

    } catch (error) {
      this.logger.error('DatabaseManager', 'Error pruning tool-use memories', error);
      return 0;
    }
  }
  
  /**
   * Prune corrections beyond the retention cap, keeping the strongest.
   *
   * Targets type = 'correction' — what production actually writes. The
   * previous implementation targeted 'correction-pattern' with a
   * preference_key requirement; only the dead PatternStore path ever wrote
   * that type (and never with preference_key), so the documented "last N
   * corrections" retention had never fired.
   */
  private pruneOldCorrections(db: Database.Database, keepCount: number, dryRun: boolean): number {
    if (keepCount < 0) return 0; // Keep all

    try {
      const rows = db.prepare(`
        SELECT id, access_count, cite_count, load_count, timestamp, last_accessed, type
        FROM memories
        WHERE type = 'correction'
      `).all() as any[];

      if (rows.length <= keepCount) {
        return 0;
      }

      const scored = rows.map(r => ({
        id: r.id,
        strength: MemoryRetrieval.computeStrength(r as Memory),
      })).sort((a, b) => b.strength - a.strength);

      const toRemove = scored.slice(keepCount);

      if (!dryRun && toRemove.length > 0) {
        // Prepared-statement deletion, matching pruneOldToolUse (audit 2026-04-23)
        const placeholders = toRemove.map(() => '?').join(',');
        db.prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
          .run(...toRemove.map(r => r.id));
      }

      this.logger.info('DatabaseManager', `Pruned ${toRemove.length} weak corrections (kept ${keepCount} strongest)`);
      if (toRemove.length > 0 && !dryRun) {
        // stderr — this can run inside the MCP server, stdout is JSON-RPC
        console.error(`🔄 Pruned ${toRemove.length} weak correction memories`);
      }
      return toRemove.length;

    } catch (error) {
      this.logger.error('DatabaseManager', 'Error pruning corrections', error);
      return 0;
    }
  }
  
  /**
   * Get compaction configuration
   */
  private getCompactionConfig(): CompactionConfig {
    const config = this.config.getConfig();
    
    // Default configuration if not specified
    return (config as any).database?.compaction || {
      autoCompact: true,
      compactThreshold: 10 * 1024 * 1024, // 10MB
      maxMemories: 10000,
      retention: {
        toolUse: 1000,
        corrections: 100,
        preferences: -1, // Keep forever
        projectKnowledge: -1 // Keep forever
      }
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