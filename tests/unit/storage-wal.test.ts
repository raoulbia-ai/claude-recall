/**
 * WAL lifecycle (#4): the write-ahead log must stay bounded and be truncated
 * on close so the -wal file can't linger at tens of MB after the process exits.
 * Uses an on-disk DB (WAL files don't exist for :memory:).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryStorage } from '../../src/memory/storage';

describe('MemoryStorage WAL lifecycle (#4)', () => {
  let tmpDir = '';
  let dbPath = '';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-wal-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('sets a bounded journal_size_limit on open', () => {
    const storage = new MemoryStorage(dbPath);
    try {
      const limit = storage.getDatabase().pragma('journal_size_limit', { simple: true });
      expect(limit).toBe(8388608); // 8 MB ceiling
    } finally {
      storage.close();
    }
  });

  it('runs in WAL mode', () => {
    const storage = new MemoryStorage(dbPath);
    try {
      const mode = storage.getDatabase().pragma('journal_mode', { simple: true });
      expect(String(mode).toLowerCase()).toBe('wal');
    } finally {
      storage.close();
    }
  });

  it('truncates the WAL on close (no lingering -wal bytes)', () => {
    const storage = new MemoryStorage(dbPath);
    for (let i = 0; i < 50; i++) {
      storage.save({ key: `k${i}`, value: { data: `value ${i}` }, type: 'preference' });
    }
    storage.close();

    const walPath = `${dbPath}-wal`;
    // After a TRUNCATE checkpoint + close, the WAL is either removed or 0 bytes.
    if (fs.existsSync(walPath)) {
      expect(fs.statSync(walPath).size).toBe(0);
    }
  });

  it('close() does not throw and data survives reopen', () => {
    const s1 = new MemoryStorage(dbPath);
    s1.save({ key: 'persist', value: { ok: true }, type: 'preference' });
    expect(() => s1.close()).not.toThrow();

    const s2 = new MemoryStorage(dbPath);
    try {
      expect(s2.retrieve('persist')?.value).toEqual({ ok: true });
    } finally {
      s2.close();
    }
  });
});
