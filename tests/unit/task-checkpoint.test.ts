import { MemoryStorage } from '../../src/memory/storage';

/**
 * Task checkpoint — one-per-project structured snapshot of work in progress.
 *
 * Contract:
 *   - saveCheckpoint(projectId, data) — writes the checkpoint, replacing any
 *     existing checkpoint for the same project.
 *   - loadCheckpoint(projectId) — returns the latest checkpoint, or null.
 *   - Multiple saves to the same project never accumulate — always replace.
 *   - Different projects keep independent checkpoints.
 *   - Stored as type='task-checkpoint' in the memories table.
 *   - Bypasses fuzzy dedup (uses a deterministic key per project).
 */
describe('task checkpoint storage', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });

  test('saveCheckpoint stores a checkpoint that loadCheckpoint returns', () => {
    storage.saveCheckpoint('project-a', {
      completed: 'inference layer, domain layer',
      remaining: 'wire server.js, strip 3GPP URNs, test onboard',
      blockers: 'none',
      notes: 'see inference/README.md',
    });

    const loaded = storage.loadCheckpoint('project-a');
    expect(loaded).not.toBeNull();
    expect(loaded!.completed).toBe('inference layer, domain layer');
    expect(loaded!.remaining).toBe('wire server.js, strip 3GPP URNs, test onboard');
    expect(loaded!.blockers).toBe('none');
    expect(loaded!.notes).toBe('see inference/README.md');
    expect(loaded!.updated_at).toBeGreaterThan(0);
  });

  test('saveCheckpoint replaces previous checkpoint for the same project', () => {
    storage.saveCheckpoint('project-a', {
      completed: 'first thing',
      remaining: 'second thing',
      blockers: 'none',
    });

    storage.saveCheckpoint('project-a', {
      completed: 'first thing, second thing',
      remaining: 'third thing',
      blockers: 'waiting on review',
    });

    const loaded = storage.loadCheckpoint('project-a');
    expect(loaded!.completed).toBe('first thing, second thing');
    expect(loaded!.remaining).toBe('third thing');
    expect(loaded!.blockers).toBe('waiting on review');

    // Verify only one checkpoint row exists for project-a
    const all = storage.searchByContext({ project_id: 'project-a' });
    const checkpoints = all.filter(m => m.type === 'task-checkpoint');
    expect(checkpoints).toHaveLength(1);
  });

  test('loadCheckpoint returns null when no checkpoint exists', () => {
    expect(storage.loadCheckpoint('nonexistent-project')).toBeNull();
  });

  test('different projects keep independent checkpoints', () => {
    storage.saveCheckpoint('project-a', {
      completed: 'A done',
      remaining: 'A todo',
      blockers: 'none',
    });
    storage.saveCheckpoint('project-b', {
      completed: 'B done',
      remaining: 'B todo',
      blockers: 'none',
    });

    expect(storage.loadCheckpoint('project-a')!.completed).toBe('A done');
    expect(storage.loadCheckpoint('project-b')!.completed).toBe('B done');
  });

  test('hasCheckpoint returns true/false correctly (for load_rules hint)', () => {
    expect(storage.hasCheckpoint('project-a')).toBe(false);
    storage.saveCheckpoint('project-a', {
      completed: 'x',
      remaining: 'y',
      blockers: 'none',
    });
    expect(storage.hasCheckpoint('project-a')).toBe(true);
  });
});
