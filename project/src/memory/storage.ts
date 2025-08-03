import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

export interface Memory {
  key: string;
  value: any;
  type: string;
  project_id?: string;
  file_path?: string;
  timestamp?: number;
  access_count?: number;
  last_accessed?: number;
  relevance_score?: number;
}

export class MemoryStorage {
  private db: Database.Database;
  
  constructor(dbPath: string) {
    this.db = new Database(dbPath);
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
      (key, value, type, project_id, file_path, timestamp, relevance_score, access_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      memory.key,
      JSON.stringify(memory.value),
      memory.type,
      memory.project_id || null,
      memory.file_path || null,
      memory.timestamp || Date.now(),
      memory.relevance_score || 1.0,
      memory.access_count || 0
    );
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
      key: row.key,
      value: JSON.parse(row.value),
      type: row.type,
      project_id: row.project_id,
      file_path: row.file_path,
      timestamp: row.timestamp,
      access_count: row.access_count,
      last_accessed: row.last_accessed,
      relevance_score: row.relevance_score
    };
  }
  
  searchByContext(context: { project_id?: string; file_path?: string; type?: string }): Memory[] {
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
    
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];
    
    return rows.map(row => this.rowToMemory(row));
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
  
  close(): void {
    this.db.close();
  }
}