const { ConfigService } = require('./dist/services/config');
const { QueueSystem } = require('./dist/services/queue-system');

const config = ConfigService.getInstance();
const dbPath = config.getDatabasePath();
console.log('Database path:', dbPath);

const queueSystem = QueueSystem.getInstance();
console.log('QueueSystem initialized');

// Try to create tables
queueSystem.executeTransaction((db) => {
  console.log('Creating queue tables...');
  
  // Create queue_messages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS queue_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_name TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      created_at INTEGER NOT NULL,
      scheduled_at INTEGER,
      processed_at INTEGER,
      next_retry_at INTEGER,
      correlation_id TEXT,
      metadata TEXT
    )
  `);
  
  // Create dead_letter_queue table
  db.exec(`
    CREATE TABLE IF NOT EXISTS dead_letter_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_queue_name TEXT NOT NULL,
      message_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      error_message TEXT,
      failed_at INTEGER NOT NULL,
      attempts INTEGER,
      correlation_id TEXT,
      metadata TEXT
    )
  `);
  
  console.log('Tables created');
});

// Check tables
const tables = queueSystem.executeQuery("SELECT name FROM sqlite_master WHERE type='table'");
console.log('Tables:', tables.map(t => t.name));
