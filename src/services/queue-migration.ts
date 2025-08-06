import { QueueSystem } from './queue-system';
import { ConfigService } from './config';
import { LoggingService } from './logging';
import Database from 'better-sqlite3';
import * as fs from 'fs';

/**
 * Migration service to safely add queue system to existing Claude Recall databases
 */
export class QueueMigration {
  private static instance: QueueMigration;
  private config = ConfigService.getInstance();
  private logger = LoggingService.getInstance();
  private db: Database.Database;

  private constructor() {
    const dbPath = this.config.getDatabasePath();
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  static getInstance(): QueueMigration {
    if (!QueueMigration.instance) {
      QueueMigration.instance = new QueueMigration();
    }
    return QueueMigration.instance;
  }

  /**
   * Check if queue system migration is needed
   */
  async isMigrationNeeded(): Promise<boolean> {
    try {
      // Check if queue tables exist
      const tablesStmt = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN ('queue_messages', 'queue_configs', 'dead_letter_queue')
      `);
      const tables = tablesStmt.all() as Array<{ name: string }>;
      
      const hasAllTables = ['queue_messages', 'queue_configs', 'dead_letter_queue']
        .every(tableName => tables.some(t => t.name === tableName));
      
      return !hasAllTables;
    } catch (error) {
      this.logger.error('QueueMigration', 'Error checking migration status', error);
      return true; // Assume migration needed on error
    }
  }

  /**
   * Get current migration status
   */
  async getMigrationStatus(): Promise<{
    isMigrationNeeded: boolean;
    existingTables: string[];
    missingTables: string[];
    databaseSize: number;
    backupExists: boolean;
  }> {
    const requiredTables = ['queue_messages', 'queue_configs', 'dead_letter_queue'];
    
    // Get existing tables
    const tablesStmt = this.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `);
    const allTables = tablesStmt.all() as Array<{ name: string }>;
    const existingTables = allTables.map(t => t.name);
    
    // Find missing queue tables
    const queueTables = allTables.filter(t => requiredTables.includes(t.name)).map(t => t.name);
    const missingTables = requiredTables.filter(t => !queueTables.includes(t));
    
    // Get database size
    const dbPath = this.config.getDatabasePath();
    const stats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null;
    const databaseSize = stats ? stats.size : 0;
    
    // Check for backup
    const backupPath = `${dbPath}.pre-queue-backup`;
    const backupExists = fs.existsSync(backupPath);
    
    return {
      isMigrationNeeded: missingTables.length > 0,
      existingTables,
      missingTables,
      databaseSize,
      backupExists
    };
  }

  /**
   * Perform the migration to add queue system
   */
  async migrate(options: { createBackup?: boolean; force?: boolean } = {}): Promise<{
    success: boolean;
    backupPath?: string;
    tablesCreated: string[];
    duration: number;
    error?: string;
  }> {
    const startTime = Date.now();
    let backupPath: string | undefined;
    const tablesCreated: string[] = [];

    try {
      this.logger.info('QueueMigration', 'Starting queue system migration');

      // Check if migration is needed (unless forced)
      if (!options.force) {
        const migrationNeeded = await this.isMigrationNeeded();
        if (!migrationNeeded) {
          this.logger.info('QueueMigration', 'Migration not needed, queue tables already exist');
          return {
            success: true,
            tablesCreated: [],
            duration: Date.now() - startTime
          };
        }
      }

      // Create backup if requested
      if (options.createBackup !== false) {
        backupPath = await this.createBackup();
        this.logger.info('QueueMigration', `Backup created at: ${backupPath}`);
      }

      // Begin migration transaction
      const migration = this.db.transaction(() => {
        // Create queue_messages table
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS queue_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            queue_name TEXT NOT NULL,
            payload TEXT NOT NULL,
            priority INTEGER DEFAULT 0,
            scheduled_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER DEFAULT 0,
            max_retries INTEGER DEFAULT 3,
            error_message TEXT,
            processed_at INTEGER,
            next_retry_at INTEGER,
            correlation_id TEXT,
            message_type TEXT NOT NULL,
            metadata TEXT,
            
            CONSTRAINT chk_status CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying'))
          );
        `);
        tablesCreated.push('queue_messages');

        // Create queue_configs table
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS queue_configs (
            queue_name TEXT PRIMARY KEY,
            retry_config TEXT NOT NULL,
            processor_config TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `);
        tablesCreated.push('queue_configs');

        // Create dead_letter_queue table
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS dead_letter_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original_queue_name TEXT NOT NULL,
            original_message_id INTEGER NOT NULL,
            payload TEXT NOT NULL,
            error_message TEXT NOT NULL,
            retry_count INTEGER NOT NULL,
            failed_at INTEGER NOT NULL,
            correlation_id TEXT,
            message_type TEXT NOT NULL,
            metadata TEXT
          );
        `);
        tablesCreated.push('dead_letter_queue');

        // Create indexes
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS idx_queue_messages_queue_status 
          ON queue_messages(queue_name, status);
          
          CREATE INDEX IF NOT EXISTS idx_queue_messages_scheduled 
          ON queue_messages(scheduled_at) WHERE status IN ('pending', 'retrying');
          
          CREATE INDEX IF NOT EXISTS idx_queue_messages_priority 
          ON queue_messages(queue_name, priority DESC, created_at ASC) 
          WHERE status IN ('pending', 'retrying');
          
          CREATE INDEX IF NOT EXISTS idx_queue_messages_correlation 
          ON queue_messages(correlation_id);
          
          CREATE INDEX IF NOT EXISTS idx_queue_messages_cleanup 
          ON queue_messages(status, processed_at);
          
          CREATE INDEX IF NOT EXISTS idx_dead_letter_failed_at 
          ON dead_letter_queue(failed_at);
        `);

        // Insert default queue configurations
        const now = Date.now();
        this.db.prepare(`
          INSERT OR IGNORE INTO queue_configs (queue_name, retry_config, processor_config, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('hook-events', 
          JSON.stringify({ maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000 }),
          JSON.stringify({ batchSize: 5, processingTimeout: 15000, cleanupInterval: 2000 }),
          now, now
        );

        this.db.prepare(`
          INSERT OR IGNORE INTO queue_configs (queue_name, retry_config, processor_config, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('mcp-operations',
          JSON.stringify({ maxRetries: 5, baseDelayMs: 30000, maxDelayMs: 300000 }),
          JSON.stringify({ batchSize: 3, processingTimeout: 30000, cleanupInterval: 3000 }),
          now, now
        );

        this.db.prepare(`
          INSERT OR IGNORE INTO queue_configs (queue_name, retry_config, processor_config, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('memory-operations',
          JSON.stringify({ maxRetries: 3, baseDelayMs: 30000, maxDelayMs: 300000 }),
          JSON.stringify({ batchSize: 10, processingTimeout: 10000, cleanupInterval: 1000 }),
          now, now
        );

        this.db.prepare(`
          INSERT OR IGNORE INTO queue_configs (queue_name, retry_config, processor_config, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run('pattern-detection',
          JSON.stringify({ maxRetries: 2, baseDelayMs: 30000, maxDelayMs: 300000 }),
          JSON.stringify({ batchSize: 5, processingTimeout: 20000, cleanupInterval: 3000 }),
          now, now
        );
      });

      // Execute migration
      migration();

      const duration = Date.now() - startTime;
      this.logger.info('QueueMigration', 'Migration completed successfully', {
        tablesCreated,
        duration: `${duration}ms`,
        backupPath
      });

      return {
        success: true,
        backupPath,
        tablesCreated,
        duration
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('QueueMigration', 'Migration failed', {
        error: errorMessage,
        duration: `${duration}ms`,
        tablesCreated,
        backupPath
      });

      return {
        success: false,
        backupPath,
        tablesCreated,
        duration,
        error: errorMessage
      };
    }
  }

  /**
   * Create a backup of the current database
   */
  private async createBackup(): Promise<string> {
    const dbPath = this.config.getDatabasePath();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${dbPath}.pre-queue-${timestamp}.backup`;
    
    // Copy the database file
    fs.copyFileSync(dbPath, backupPath);
    
    // Verify backup
    const originalStats = fs.statSync(dbPath);
    const backupStats = fs.statSync(backupPath);
    
    if (originalStats.size !== backupStats.size) {
      throw new Error('Backup verification failed: size mismatch');
    }

    return backupPath;
  }

  /**
   * Rollback migration by restoring from backup
   */
  async rollback(backupPath: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      if (!fs.existsSync(backupPath)) {
        throw new Error(`Backup file not found: ${backupPath}`);
      }

      const dbPath = this.config.getDatabasePath();
      
      // Close current database connection
      this.db.close();
      
      // Replace current database with backup
      fs.copyFileSync(backupPath, dbPath);
      
      // Reconnect to database
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      this.logger.info('QueueMigration', 'Migration rolled back successfully', { backupPath });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('QueueMigration', 'Rollback failed', { error: errorMessage, backupPath });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Verify migration was successful
   */
  async verifyMigration(): Promise<{
    isValid: boolean;
    issues: string[];
    tableInfo: Array<{ name: string; rowCount: number }>;
  }> {
    const issues: string[] = [];
    const tableInfo: Array<{ name: string; rowCount: number }> = [];
    
    try {
      const requiredTables = ['queue_messages', 'queue_configs', 'dead_letter_queue'];
      
      // Check all required tables exist
      const tablesStmt = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN (${requiredTables.map(() => '?').join(',')})
      `);
      const existingTables = tablesStmt.all(...requiredTables) as Array<{ name: string }>;
      
      for (const requiredTable of requiredTables) {
        if (!existingTables.some(t => t.name === requiredTable)) {
          issues.push(`Missing required table: ${requiredTable}`);
        } else {
          // Get row count
          const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${requiredTable}`);
          const countResult = countStmt.get() as { count: number };
          tableInfo.push({ name: requiredTable, rowCount: countResult.count });
        }
      }

      // Check for required indexes
      const requiredIndexes = [
        'idx_queue_messages_queue_status',
        'idx_queue_messages_scheduled',
        'idx_queue_messages_priority',
        'idx_queue_messages_correlation',
        'idx_queue_messages_cleanup',
        'idx_dead_letter_failed_at'
      ];

      const indexesStmt = this.db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name IN (${requiredIndexes.map(() => '?').join(',')})
      `);
      const existingIndexes = indexesStmt.all(...requiredIndexes) as Array<{ name: string }>;
      
      for (const requiredIndex of requiredIndexes) {
        if (!existingIndexes.some(i => i.name === requiredIndex)) {
          issues.push(`Missing required index: ${requiredIndex}`);
        }
      }

      // Verify queue configs were created
      if (tableInfo.find(t => t.name === 'queue_configs')?.rowCount === 0) {
        issues.push('No queue configurations found - default configs may not have been inserted');
      }

      return {
        isValid: issues.length === 0,
        issues,
        tableInfo
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      issues.push(`Verification error: ${errorMessage}`);
      
      return {
        isValid: false,
        issues,
        tableInfo
      };
    }
  }

  /**
   * Clean up old backup files
   */
  async cleanupOldBackups(keepCount: number = 3): Promise<{
    cleaned: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let cleaned = 0;
    
    try {
      const dbPath = this.config.getDatabasePath();
      const dbDir = require('path').dirname(dbPath);
      const dbName = require('path').basename(dbPath);
      
      const files = fs.readdirSync(dbDir)
        .filter(f => f.startsWith(`${dbName}.pre-queue-`) && f.endsWith('.backup'))
        .map(f => ({
          name: f,
          path: require('path').join(dbDir, f),
          mtime: fs.statSync(require('path').join(dbDir, f)).mtime
        }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      // Remove old backups (keep only the newest ones)
      for (let i = keepCount; i < files.length; i++) {
        try {
          fs.unlinkSync(files[i].path);
          cleaned++;
          this.logger.info('QueueMigration', `Removed old backup: ${files[i].name}`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`Failed to remove ${files[i].name}: ${errorMessage}`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Cleanup failed: ${errorMessage}`);
    }
    
    return { cleaned, errors };
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}