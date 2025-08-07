import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface Memory {
  id?: number;
  key: string;
  value: any;
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
        // Database is already initialized, skip schema execution
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
  
  save(memory: Memory): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memories 
      (key, value, type, project_id, file_path, timestamp, relevance_score, access_count, 
       preference_key, is_active, superseded_by, superseded_at, confidence_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      memory.confidence_score || null
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
      confidence_score: row.confidence_score
    };
  }
  
  searchByContext(context: { project_id?: string; file_path?: string; type?: string; keywords?: string[] }): Memory[] {
    let query = 'SELECT * FROM memories WHERE 1=1';
    const params: any[] = [];
    
    if (context.project_id) {
      query += ' AND project_id = ?';
      params.push(context.project_id);
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
      const keywordConditions = context.keywords.map(() => 'value LIKE ?').join(' OR ');
      query += ` AND (${keywordConditions})`;
      
      // Add parameters for each keyword
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