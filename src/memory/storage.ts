import Database from 'better-sqlite3';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Structured memory value format (v0.7.0+)
export interface StructuredMemoryValue {
  title?: string;  // Concise identifier
  description?: string;  // One-sentence summary
  content: any;  // Actual memory data
}

export interface Memory {
  id?: number;
  key: string;
  value: any | StructuredMemoryValue;  // Supports both old and new format
  type: string;
  project_id?: string;
  file_path?: string;
  timestamp?: number;
  access_count?: number;
  last_accessed?: number;
  relevance_score?: number;
  preference_key?: string;
  is_active?: boolean;
  superseded_by?: string;
  superseded_at?: number;
  confidence_score?: number;
  sophistication_level?: number;  // 1-4: Procedural → Compositional
  scope?: 'universal' | 'project' | null;  // v0.8.0: Memory scope
  content_hash?: string;
}

export class MemoryStorage {
  private db: Database.Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    // Enable WAL mode for better concurrency and to ensure writes are visible
    this.db.pragma('journal_mode = WAL');
    // Ensure changes are synced to disk
    this.db.pragma('synchronous = NORMAL');
    this.initialize();
  }
  
  private initialize(): void {
    // Check if the database is already initialized
    try {
      const tableExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
      ).get();

      if (tableExists) {
        // Database is already initialized, run schema migration if needed
        this.migrateSchema();
        return;
      }
    } catch (error) {
      // If checking fails, proceed with initialization
    }

    // Initialize the database schema
    try {
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');
      this.db.exec(schema);
    } catch (error) {
      // Log error but don't throw - database might already be initialized
      console.error('Error initializing database schema:', error);

      // Verify that the memories table exists
      const tableExists = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memories'"
      ).get();

      if (!tableExists) {
        // Re-throw the error if the table doesn't exist
        throw new Error(`Failed to initialize database: ${error}`);
      }
    }
  }

  /**
   * Migrate existing database schema to add missing columns
   * Adds columns introduced in v0.7.0+ (sophistication_level, scope)
   */
  private migrateSchema(): void {
    try {
      // Get existing columns
      const columns = this.db.prepare("PRAGMA table_info(memories)").all() as Array<{name: string}>;
      const columnNames = columns.map(c => c.name);

      // Add sophistication_level if missing (v0.7.0+)
      if (!columnNames.includes('sophistication_level')) {
        console.log('📋 Migrating database schema: Adding sophistication_level column...');
        this.db.exec('ALTER TABLE memories ADD COLUMN sophistication_level INTEGER DEFAULT 1');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_memories_sophistication ON memories(sophistication_level)');
        console.log('✅ Added sophistication_level column');
      }

      // Add scope if missing (v0.7.2+)
      if (!columnNames.includes('scope')) {
        console.log('📋 Migrating database schema: Adding scope column...');
        this.db.exec("ALTER TABLE memories ADD COLUMN scope TEXT CHECK(scope IN ('universal', 'project', NULL))");
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_memories_scope_project ON memories(scope, project_id)');
        console.log('✅ Added scope column');
      }

      // Add content_hash if missing (content dedup)
      if (!columnNames.includes('content_hash')) {
        console.log('📋 Migrating database schema: Adding content_hash column...');
        this.db.exec('ALTER TABLE memories ADD COLUMN content_hash TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash)');

        // Backfill existing records
        const rows = this.db.prepare('SELECT id, value, type FROM memories WHERE content_hash IS NULL').all() as Array<{id: number; value: string; type: string}>;
        if (rows.length > 0) {
          const updateStmt = this.db.prepare('UPDATE memories SET content_hash = ? WHERE id = ?');
          const backfillTransaction = this.db.transaction(() => {
            for (const row of rows) {
              const hash = this.computeContentHash(JSON.parse(row.value), row.type);
              updateStmt.run(hash, row.id);
            }
          });
          backfillTransaction();
          console.log(`✅ Added content_hash column, backfilled ${rows.length} records`);
        } else {
          console.log('✅ Added content_hash column');
        }
      }
    } catch (error) {
      console.error('⚠️  Schema migration error:', error);
      // Don't throw - let the database continue with existing schema
    }
  }
  
  /**
   * Compute a SHA-256 content hash from the meaningful fields of a memory.
   * Includes type + canonical JSON of value. Excludes metadata (key, timestamps, project_id, scope, etc.)
   */
  private computeContentHash(value: any, type: string): string {
    // Use a replacer function to sort object keys at every level for canonical serialization
    const canonical = JSON.stringify({ type, value }, (_key, val) => {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const sorted: Record<string, any> = {};
        for (const k of Object.keys(val).sort()) {
          sorted[k] = val[k];
        }
        return sorted;
      }
      return val;
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  save(memory: Memory): void {
    const contentHash = this.computeContentHash(memory.value, memory.type);

    // Write-time dedup: check if identical content already exists under a different key
    const existing = this.db.prepare(
      'SELECT key, id FROM memories WHERE content_hash = ? AND key != ?'
    ).get(contentHash, memory.key) as { key: string; id: number } | undefined;

    if (existing) {
      // Bump the existing memory's timestamp and access_count to keep it fresh
      this.db.prepare(
        'UPDATE memories SET timestamp = ?, access_count = access_count + 1 WHERE key = ?'
      ).run(Date.now(), existing.key);
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      return;
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories
      (key, value, type, project_id, file_path, timestamp, relevance_score, access_count,
       preference_key, is_active, superseded_by, superseded_at, confidence_score, sophistication_level, scope, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      memory.key,
      JSON.stringify(memory.value),
      memory.type,
      memory.project_id || null,
      memory.file_path || null,
      memory.timestamp || Date.now(),
      memory.relevance_score || 1.0,
      memory.access_count || 0,
      memory.preference_key || null,
      memory.is_active !== undefined ? (memory.is_active ? 1 : 0) : 1,
      memory.superseded_by || null,
      memory.superseded_at || null,
      memory.confidence_score || null,
      memory.sophistication_level || 1,
      memory.scope || null,
      contentHash
    );

    // Force a WAL checkpoint to ensure the data is written to the main database file
    // This ensures that other processes (like CLI) can see the changes immediately
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }
  
  retrieve(key: string): Memory | null {
    const stmt = this.db.prepare('SELECT * FROM memories WHERE key = ?');
    const row = stmt.get(key) as any;
    
    if (row) {
      this.updateAccessCount(key);
      // Fetch updated row after incrementing access count
      const updatedRow = stmt.get(key) as any;
      return this.rowToMemory(updatedRow);
    }
    
    return null;
  }
  
  private updateAccessCount(key: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories 
      SET access_count = access_count + 1, 
          last_accessed = ? 
      WHERE key = ?
    `);
    stmt.run(Date.now(), key);
  }
  
  private rowToMemory(row: any): Memory {
    return {
      id: row.id,
      key: row.key,
      value: JSON.parse(row.value),
      type: row.type,
      project_id: row.project_id,
      file_path: row.file_path,
      timestamp: row.timestamp,
      access_count: row.access_count,
      last_accessed: row.last_accessed,
      relevance_score: row.relevance_score,
      preference_key: row.preference_key,
      is_active: row.is_active === 1,
      superseded_by: row.superseded_by,
      superseded_at: row.superseded_at,
      confidence_score: row.confidence_score,
      sophistication_level: row.sophistication_level || 1,
      scope: row.scope || null,
      content_hash: row.content_hash || null
    };
  }
  
  searchByContext(context: { project_id?: string; file_path?: string; type?: string; keywords?: string[] }): Memory[] {
    let query = 'SELECT * FROM memories WHERE 1=1';
    const params: any[] = [];

    if (context.project_id) {
      // Include project-specific OR universal OR unscoped (NULL) memories
      query += ' AND (project_id = ? OR scope = ? OR project_id IS NULL)';
      params.push(context.project_id, 'universal');
    }

    if (context.file_path) {
      query += ' AND file_path = ?';
      params.push(context.file_path);
    }
    
    if (context.type) {
      query += ' AND type = ?';
      params.push(context.type);
    }
    
    // Add keyword search in value field
    if (context.keywords && context.keywords.length > 0) {
      if (context.keywords.length >= 3) {
        // Many keywords (likely conversational input): require at least 2 to match.
        // Build a SUM of CASE expressions and require the total >= 2.
        const cases = context.keywords.map(() => "(CASE WHEN value LIKE ? THEN 1 ELSE 0 END)").join(' + ');
        query += ` AND (${cases}) >= 2`;
      } else {
        // Few keywords: match any (original behaviour)
        const keywordConditions = context.keywords.map(() => 'value LIKE ?').join(' OR ');
        query += ` AND (${keywordConditions})`;
      }

      for (const keyword of context.keywords) {
        params.push(`%${keyword}%`);
      }
    }
    
    // Order by type priority and relevance
    query += ` ORDER BY 
      CASE type 
        WHEN 'project-knowledge' THEN 1 
        WHEN 'preference' THEN 2 
        WHEN 'tool-use' THEN 3 
        ELSE 4 
      END,
      relevance_score DESC,
      timestamp DESC`;
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => this.rowToMemory(row));
  }
  
  clear(type?: string): number {
    let stmt;
    let result;
    
    if (type) {
      // Clear specific type
      stmt = this.db.prepare('DELETE FROM memories WHERE type = ?');
      result = stmt.run(type);
    } else {
      // Clear all memories
      stmt = this.db.prepare('DELETE FROM memories');
      result = stmt.run();
    }
    
    // Force checkpoint to ensure deletion is persisted
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    
    return result.changes;
  }
  
  search(query: string): Memory[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      WHERE key LIKE ? OR value LIKE ?
      ORDER BY relevance_score DESC
      LIMIT 20
    `);
    
    const searchPattern = `%${query}%`;
    const rows = stmt.all(searchPattern, searchPattern) as any[];
    
    return rows.map(row => this.rowToMemory(row));
  }
  
  getStats(): { total: number; byType: Record<string, number> } {
    const totalStmt = this.db.prepare('SELECT COUNT(*) as count FROM memories');
    const total = (totalStmt.get() as any).count;
    
    const byTypeStmt = this.db.prepare('SELECT type, COUNT(*) as count FROM memories GROUP BY type');
    const byTypeRows = byTypeStmt.all() as any[];
    
    const byType: Record<string, number> = {};
    for (const row of byTypeRows) {
      byType[row.type] = row.count;
    }
    
    return { total, byType };
  }
  
  /**
   * Update a memory record by key
   */
  update(key: string, updates: Partial<Memory>): void {
    const fields = Object.keys(updates).filter(k => k !== 'key'); // Don't update key
    const setClause = fields.map(field => `${field} = ?`).join(', ');
    const values = fields.map(field => {
      const value = (updates as any)[field];
      if (field === 'value') {
        return JSON.stringify(value);
      } else if (field === 'is_active') {
        return value ? 1 : 0;
      } else {
        return value;
      }
    });
    
    const stmt = this.db.prepare(`UPDATE memories SET ${setClause} WHERE key = ?`);
    stmt.run(...values, key);
  }

  /**
   * Get preferences by preference key
   */
  getByPreferenceKey(preferenceKey: string, projectId?: string): Memory[] {
    let query = 'SELECT * FROM memories WHERE preference_key = ? AND type = ?';
    const params: any[] = [preferenceKey, 'preference'];
    
    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }
    
    query += ' ORDER BY timestamp DESC';
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * Get preferences by context with active filtering
   */
  getPreferencesByContext(context: { project_id?: string; file_path?: string }): Memory[] {
    let query = 'SELECT * FROM memories WHERE type = ?';
    const params: any[] = ['preference'];
    
    if (context.project_id) {
      query += ' AND project_id = ?';
      params.push(context.project_id);
    }
    
    if (context.file_path) {
      query += ' AND file_path = ?';
      params.push(context.file_path);
    }
    
    // Order by preference key, then by timestamp desc to get latest per key
    query += ' ORDER BY preference_key, timestamp DESC';
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => this.rowToMemory(row));
  }

  /**
   * Mark a memory as superseded
   */
  markSuperseded(key: string, supersededBy: string): void {
    const stmt = this.db.prepare(`
      UPDATE memories 
      SET is_active = 0, superseded_by = ?, superseded_at = ?
      WHERE key = ?
    `);
    stmt.run(supersededBy, Date.now(), key);
  }

  /**
   * Get active preferences only
   */
  getActivePreferences(projectId?: string): Memory[] {
    let query = 'SELECT * FROM memories WHERE type = ? AND is_active = 1';
    const params: any[] = ['preference'];
    
    if (projectId) {
      query += ' AND project_id = ?';
      params.push(projectId);
    }
    
    query += ' ORDER BY preference_key, timestamp DESC';
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => this.rowToMemory(row));
  }

  getDatabase(): Database.Database {
    return this.db;
  }
  
  close(): void {
    this.db.close();
  }
}