import Database from 'better-sqlite3';
import { presentTables, tableColumns } from '../../src/services/sqlite-tables';

/**
 * Maintenance runs on whatever file the host has, including one written before
 * a table or column existed. These helpers answer "is it there?" without ever
 * throwing, because compaction must degrade to doing less, not to failing.
 */
describe('sqlite-tables', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE memories (id INTEGER PRIMARY KEY, key TEXT, confirmed_at INTEGER);
      CREATE TABLE episodes (id TEXT PRIMARY KEY);
    `);
  });

  afterEach(() => db.close());

  it('reports only the tables that exist', () => {
    const present = presentTables(db, ['memories', 'episodes', 'candidate_lessons']);

    expect(present.has('memories')).toBe(true);
    expect(present.has('episodes')).toBe(true);
    expect(present.has('candidate_lessons')).toBe(false);
  });

  it('asks nothing when given no names', () => {
    expect(presentTables(db, []).size).toBe(0);
  });

  it('lists a table\'s columns, and nothing for a table that is not there', () => {
    expect([...tableColumns(db, 'memories')].sort()).toEqual(['confirmed_at', 'id', 'key']);
    expect(tableColumns(db, 'no_such_table').size).toBe(0);
  });

  it('returns empty rather than throwing on a closed connection', () => {
    db.close();

    expect(presentTables(db, ['memories']).size).toBe(0);
    expect(tableColumns(db, 'memories').size).toBe(0);

    db = new Database(':memory:'); // afterEach closes something valid
  });
});
