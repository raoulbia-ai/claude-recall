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
  relevance_score REAL DEFAULT 1.0,
  preference_key TEXT,
  is_active BOOLEAN DEFAULT 1,
  superseded_by TEXT,
  superseded_at INTEGER,
  confidence_score REAL
);

CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
CREATE INDEX IF NOT EXISTS idx_memories_timestamp ON memories(timestamp);
CREATE INDEX IF NOT EXISTS idx_memories_preference_key ON memories(preference_key, is_active);
CREATE INDEX IF NOT EXISTS idx_memories_active ON memories(is_active);
CREATE INDEX IF NOT EXISTS idx_memories_superseded ON memories(superseded_by);