import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from './config';
import { LoggingService } from './logging';

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
    let deduplicatedCount = 0;
    
    try {
      // Create backup if not dry run
      if (!dryRun) {
        backupPath = await this.createBackup();
        this.logger.info('DatabaseManager', `Created backup at ${backupPath}`);
        console.log(`🔄 Created backup at ${backupPath}`);
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
        console.log('🗜️  Compacting database...');
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
        console.log(`✅ Database compacted, saved ${savedMB}MB`);
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
      // Find duplicates
      const duplicates = db.prepare(`
        SELECT type, key, value, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM memories
        GROUP BY type, key, value
        HAVING COUNT(*) > 1
      `).all() as any[];
      
      let totalRemoved = 0;
      
      for (const dup of duplicates) {
        const ids = dup.ids.split(',').map((id: string) => parseInt(id));
        const keepId = Math.min(...ids); // Keep the oldest
        const removeIds = ids.filter((id: number) => id !== keepId);
        
        if (!dryRun) {
          const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
          for (const id of removeIds) {
            stmt.run(id);
          }
        }
        
        totalRemoved += removeIds.length;
      }
      
      this.logger.info('DatabaseManager', `Deduplicated ${totalRemoved} memories`);
      if (totalRemoved > 0 && !dryRun) {
        console.log(`🔄 Deduplicated ${totalRemoved} identical memories`);
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
      // Find tool-use memories to remove
      const toRemove = db.prepare(`
        SELECT id FROM memories
        WHERE type = 'tool-use'
        ORDER BY timestamp DESC
        LIMIT -1 OFFSET ?
      `).all(keepCount) as any[];
      
      if (!dryRun && toRemove.length > 0) {
        const ids = toRemove.map(r => r.id).join(',');
        db.exec(`DELETE FROM memories WHERE id IN (${ids})`);
      }
      
      this.logger.info('DatabaseManager', `Pruned ${toRemove.length} old tool-use memories`);
      if (toRemove.length > 0 && !dryRun) {
        console.log(`🔄 Pruned ${toRemove.length} old tool-use memories`);
      }
      return toRemove.length;
      
    } catch (error) {
      this.logger.error('DatabaseManager', 'Error pruning tool-use memories', error);
      return 0;
    }
  }
  
  /**
   * Prune old corrections
   */
  private pruneOldCorrections(db: Database.Database, keepPerPattern: number, dryRun: boolean): number {
    if (keepPerPattern < 0) return 0; // Keep all
    
    try {
      // Get all correction patterns
      const patterns = db.prepare(`
        SELECT DISTINCT preference_key
        FROM memories
        WHERE type = 'correction-pattern'
        AND preference_key IS NOT NULL
      `).all() as any[];
      
      let totalRemoved = 0;
      
      for (const pattern of patterns) {
        // Find corrections to remove for this pattern
        const toRemove = db.prepare(`
          SELECT id FROM memories
          WHERE type = 'correction-pattern'
          AND preference_key = ?
          ORDER BY timestamp DESC
          LIMIT -1 OFFSET ?
        `).all(pattern.preference_key, keepPerPattern) as any[];
        
        if (!dryRun && toRemove.length > 0) {
          const ids = toRemove.map(r => r.id).join(',');
          db.exec(`DELETE FROM memories WHERE id IN (${ids})`);
        }
        
        totalRemoved += toRemove.length;
      }
      
      this.logger.info('DatabaseManager', `Pruned ${totalRemoved} old corrections`);
      if (totalRemoved > 0 && !dryRun) {
        console.log(`🔄 Pruned ${totalRemoved} old correction memories`);
      }
      return totalRemoved;
      
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