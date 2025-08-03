CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  type TEXT NOT NULL,
  project_id TEXT,
  file_path TEXT,
  timestamp INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  relevance_score REAL DEFAULT 1.0
);

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);