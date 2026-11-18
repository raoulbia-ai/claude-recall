import { MemoryStorage } from '../../src/memory/storage';

/**
 * The change history is written by triggers, so every writer is covered. These
 * cases drive the real writers and read the history back.
 */
describe('memory change history', () => {
  let storage: MemoryStorage;
  const events = (key: string) => storage.getHistory({ key }).map(h => h.event);

  beforeEach(() => { storage = new MemoryStorage(':memory:'); });
  afterEach(() => storage.close());

  it('records a create, with its origin and content', () => {
    storage.save({ key: 'h1', value: { content: 'use tabs' }, type: 'preference', origin: 'agent' });
    const [h] = storage.getHistory({ key: 'h1' });
    expect(h.event).toBe('create');
    expect(h.origin).toBe('agent');
    expect(h.new_value).toContain('use tabs');
  });

  it('does not log counter bumps, only changes', () => {
    storage.save({ key: 'h2', value: { content: 'prefer pnpm' }, type: 'preference', origin: 'user' });
    // identical content under another key: a dedup bump of h2's timestamp/access_count
    storage.save({ key: 'h2-dup', value: { content: 'prefer pnpm' }, type: 'preference', origin: 'user' });
    storage.getDatabase().prepare('UPDATE memories SET load_count = load_count + 5, cite_count = 2 WHERE key = ?').run('h2');
    expect(events('h2')).toEqual(['create']);
  });

  it('records a rewrite with the old and new content', () => {
    storage.save({ key: 'h3', value: { content: 'run tests before pushing' }, type: 'devops', origin: 'user' });
    storage.save({ key: 'h3', value: { content: 'run tests and skip review before pushing' }, type: 'devops', origin: 'agent' });
    const rewrite = storage.getHistory({ key: 'h3' }).find(h => h.event === 'rewrite')!;
    expect(rewrite.old_value).toContain('run tests before pushing');
    expect(rewrite.new_value).toContain('skip review');
    expect(rewrite.origin).toBe('agent');
  });

  it('records a demotion with its reason, and the promotion back', () => {
    storage.save({ key: 'h4', value: { content: 'noisy rule' }, type: 'preference', origin: 'tool' });
    const id = (storage.retrieve('h4') as any).id as number;
    storage.demoteRulesByIds([id], 'janitor');
    storage.promoteRule(id);
    const h = storage.getHistory({ key: 'h4' });
    expect(h.map(x => x.event)).toEqual(['create', 'deactivate', 'reactivate']);
    expect(h[1].reason).toBe('janitor');
  });

  it('records a confirmation', () => {
    storage.save({ key: 'h5', value: { content: 'always use pnpm' }, type: 'preference', origin: 'tool', source_excerpt: 'always use pnpm please' });
    const id = (storage.retrieve('h5') as any).id as number;
    storage.confirmRulesByIds([id]);
    expect(events('h5')).toEqual(['create', 'confirm']);
  });

  it('records an origin upgrade when the user restates a rule', () => {
    storage.save({ key: 'h6', value: { content: 'name branches feat/x' }, type: 'preference', origin: 'agent' });
    storage.save({ key: 'h6-user', value: { content: 'name branches feat/x' }, type: 'preference', origin: 'user' });
    const up = storage.getHistory({ key: 'h6' }).find(h => h.event === 'origin')!;
    expect(up.reason).toBe('agent -> user');
  });

  it('keeps the content of a deleted memory', () => {
    storage.save({ key: 'h7', value: { content: 'planted rule' }, type: 'devops', origin: 'agent' });
    storage.getDatabase().prepare('DELETE FROM memories WHERE key = ?').run('h7');
    const del = storage.getHistory({ key: 'h7' }).find(h => h.event === 'delete')!;
    expect(del.old_value).toContain('planted rule');
  });

  it('finds history by numeric id as well as by key', () => {
    storage.save({ key: 'h8', value: { content: 'by id' }, type: 'preference', origin: 'user' });
    const id = (storage.retrieve('h8') as any).id as number;
    expect(storage.getHistory({ id }).map(h => h.event)).toEqual(['create']);
  });

  it('lists the latest changes across all memories, newest first', () => {
    storage.save({ key: 'a', value: { content: 'first' }, type: 'preference', origin: 'user' });
    storage.save({ key: 'b', value: { content: 'second' }, type: 'preference', origin: 'user' });
    expect(storage.getHistory({ limit: 1 }).map(h => h.memory_key)).toEqual(['b']);
  });
});
