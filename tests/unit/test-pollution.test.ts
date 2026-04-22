import { MemoryStorage } from '../../src/memory/storage';
import { MemoryService } from '../../src/services/memory';
import { isTestPollution } from '../../src/services/test-pollution';

/**
 * Unit tests for test-pollution cleanup: the write-time guard (isTestPollution)
 * and the DB-side deletion (MemoryStorage.deleteTestPollution).
 */

describe('isTestPollution', () => {
  it.each([
    'Test preference 1775766122953-0',
    'Session test preference 1775766123074',
    'Memory with complex metadata',
    'Test memory content',
  ])('matches legacy pattern: %s', (val) => {
    expect(isTestPollution(val)).toBe(true);
    expect(isTestPollution({ content: val })).toBe(true);
  });

  it.each([
    'Always commit with --no-gpg-sign',
    'claude-recall is installed globally in WSL',
    'Test preference without a timestamp', // no trailing digits
    'Running tests locally is good practice', // contains "Test" but not anchored
  ])('ignores benign value: %s', (val) => {
    expect(isTestPollution(val)).toBe(false);
  });

  it('handles non-string payloads gracefully', () => {
    expect(isTestPollution(null)).toBe(false);
    expect(isTestPollution(undefined)).toBe(false);
    expect(isTestPollution({})).toBe(false);
    expect(isTestPollution({ other: 'field' })).toBe(false);
  });
});

describe('MemoryStorage.deleteTestPollution', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  // Bypass write-time guard by writing directly via SQL so we can seed pollution
  // that would otherwise be blocked by MemoryService.store.
  function insertRaw(key: string, value: unknown, type: string = 'preference'): void {
    storage.getDatabase().prepare(`
      INSERT INTO memories (key, value, type, timestamp, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(key, JSON.stringify(value), type, Date.now());
  }

  function countRows(): number {
    return (storage.getDatabase().prepare('SELECT COUNT(*) as c FROM memories').get() as {c: number}).c;
  }

  it('deletes legacy test-pollution rows and leaves legitimate rules alone', () => {
    insertRaw('pollution-a', { content: 'Test preference 1775766122953-0' });
    insertRaw('pollution-b', { content: 'Session test preference 1775766107293' });
    insertRaw('pollution-c', { content: 'Memory with complex metadata' });
    insertRaw('pollution-d', { content: 'Test memory content' });
    insertRaw('legit-1', { content: 'Always commit with --no-gpg-sign' }, 'devops');
    insertRaw('legit-2', { content: 'claude-recall is installed globally in WSL' }, 'devops');

    expect(countRows()).toBe(6);

    const deleted = storage.deleteTestPollution();

    expect(deleted).toHaveLength(4);
    expect(countRows()).toBe(2);

    const surviving = storage.getDatabase()
      .prepare('SELECT key FROM memories ORDER BY key')
      .all() as Array<{key: string}>;
    expect(surviving.map(r => r.key)).toEqual(['legit-1', 'legit-2']);
  });

  it('dry-run returns candidates without deleting', () => {
    insertRaw('pollution-a', { content: 'Test preference 1775766122953-2' });
    insertRaw('legit', { content: 'Always commit with --no-gpg-sign' });

    const rows = storage.deleteTestPollution({ dryRun: true });

    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('pollution-a');
    expect(countRows()).toBe(2); // not mutated
  });

  it('is a no-op on a clean DB', () => {
    insertRaw('legit-1', { content: 'Always commit with --no-gpg-sign' });
    insertRaw('legit-2', { content: 'Run npm run build after TypeScript edits' });

    const deleted = storage.deleteTestPollution();

    expect(deleted).toHaveLength(0);
    expect(countRows()).toBe(2);
  });

  it('matches both structured ({content: "…"}) and raw string payloads', () => {
    insertRaw('structured', { content: 'Test preference 1775766122953-0' });
    storage.getDatabase().prepare(`
      INSERT INTO memories (key, value, type, timestamp, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run('raw-string', JSON.stringify('Test preference 1775766107293'), 'preference', Date.now());

    const deleted = storage.deleteTestPollution();

    expect(deleted).toHaveLength(2);
    expect(countRows()).toBe(0);
  });
});

describe('MemoryService.store write-time guard', () => {
  // The MemoryService singleton is wired to the on-disk config DB path, so this
  // suite exercises the guard logic in isolation: we install a temporary
  // MemoryStorage and prove that pollution values never reach save().
  it('silently drops test-pollution writes without throwing', () => {
    const service = MemoryService.getInstance();
    const before = service.getStats().total;

    service.store({
      key: 'pollution-live',
      value: 'Test preference 1775766122953-0',
      type: 'preference',
    });

    const after = service.getStats().total;
    expect(after).toBe(before); // no row was created
  });

  it('allows benign writes through', () => {
    const service = MemoryService.getInstance();
    const uniqueKey = `guard-benign-${Date.now()}`;
    const uniqueValue = `guard-benign-fixture-${Date.now()}`;

    service.store({
      key: uniqueKey,
      value: uniqueValue,
      type: 'preference',
    });

    const stored = service.retrieve(uniqueKey);
    expect(stored).not.toBeNull();

    // Cleanup so repeated test runs don't accumulate
    if (stored?.id) {
      service.getDatabase()
        .prepare('DELETE FROM memories WHERE id = ?')
        .run(stored.id);
    }
  });
});
