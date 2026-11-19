import { MemoryService } from '../../src/services/memory';
import { MemoryStorage } from '../../src/memory/storage';
import { HookCommands } from '../../src/cli/commands/hook-commands';

/** Task checkpoints were retired in 0.52.0. */
describe('retired task checkpoints', () => {
  it('drops stored checkpoints when the database opens', () => {
    const storage = MemoryService.getInstance().getStorage();
    const db = storage.getDatabase();
    db.prepare(
      "INSERT INTO memories (key, value, type, project_id, timestamp) VALUES ('task-checkpoint:p', '{}', 'task-checkpoint', 'p', ?)"
    ).run(Date.now());
    // Re-run the migration the way a fresh start would.
    (storage as any).migrateSchema();
    expect(db.prepare("SELECT COUNT(*) AS n FROM memories WHERE type = 'task-checkpoint'").get()).toEqual({ n: 0 });
  });

  it('keeps the old SessionEnd hook id as a silent no-op', async () => {
    const out: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => { out.push(String(s)); return true; });
    try {
      await expect(
        (HookCommands as any).runOne('session-end-checkpoint', { reason: 'clear', transcript_path: '/nope' }),
      ).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    expect(out.join('')).toBe('');
  });

  it('no longer exposes checkpoint methods', () => {
    expect((MemoryService.prototype as any).saveCheckpoint).toBeUndefined();
    expect((MemoryStorage.prototype as any).loadCheckpoint).toBeUndefined();
  });
});
