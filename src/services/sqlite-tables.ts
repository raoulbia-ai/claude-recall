/**
 * Schema introspection for maintenance code.
 *
 * Compaction and pruning run on whatever file the host happens to have: a
 * database created before a column existed, or one where the outcome tables
 * were never created because nothing wrote to them yet. Maintenance must
 * degrade to doing less, never to throwing, so it asks first.
 */

import Database from 'better-sqlite3';

/** Which of `names` exist as tables on this connection. */
export function presentTables(db: Database.Database, names: string[]): Set<string> {
  if (names.length === 0) return new Set();
  const placeholders = names.map(() => '?').join(',');
  try {
    const rows = db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
    ).all(...names) as { name: string }[];
    return new Set(rows.map(r => r.name));
  } catch {
    return new Set();
  }
}

/** Column names of `table`; empty when the table does not exist. */
export function tableColumns(db: Database.Database, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return new Set(rows.map(r => r.name));
  } catch {
    return new Set();
  }
}
