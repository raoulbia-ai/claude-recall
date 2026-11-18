import { MemoryService } from '../../src/services/memory';
import { unverifiedTag } from '../../src/mcp/tools/memory-tools';

/**
 * Quarantine (default on): only the user's own words, janitor-confirmed rules
 * and user-approved rules are loaded. Everything else waits for review.
 */
describe('quarantine', () => {
  const ms = () => MemoryService.getInstance();
  const db = () => ms().getStorage().getDatabase();
  const id = (key: string) => (ms().getStorage().retrieve(key) as any).id as number;
  const loaded = () => {
    const r = ms().loadActiveRules('proj');
    return [...r.preferences, ...r.corrections, ...r.failures, ...r.devops, ...(r.solutions ?? [])].map(m => m.key);
  };
  const put = (key: string, origin: any, content: string, type = 'preference') =>
    ms().store({ key, origin, type, value: { content }, context: { projectId: 'proj' } });

  beforeEach(() => {
    delete process.env.CLAUDE_RECALL_QUARANTINE;
    db().prepare('DELETE FROM memories').run();
    db().prepare('DELETE FROM memory_history').run();
  });

  it('loads the user\'s rules and holds back everything else', () => {
    put('u', 'user', 'use tabs for indentation');
    expect(put('a', 'agent', 'prefer small pull requests')).toEqual({ stored: true, pending: true });
    expect(put('t', 'tool', 'Command failed: npm run build', 'failure')).toEqual({ stored: true, pending: true });
    db().prepare(`INSERT INTO memories (key, value, type, project_id, timestamp, is_active) VALUES ('legacy', '{"content":"old rule"}', 'devops', 'proj', ?, 1)`).run(Date.now());

    expect(loaded()).toEqual(['u']);
    expect(ms().countPending('proj')).toBe(3);
  });

  it('loads a rule once the user approves it', () => {
    put('a', 'agent', 'run the linter before committing');
    expect(ms().approveRules([id('a')])).toBe(1);
    expect(loaded()).toContain('a');
    expect(ms().countPending('proj')).toBe(0);
  });

  it('loads a rule the janitor confirmed against the user\'s words', () => {
    ms().store({ key: 'c', origin: 'tool', type: 'preference', value: { content: 'always use pnpm' },
      context: { projectId: 'proj' }, source: { excerpt: 'always use pnpm please' } });
    ms().getStorage().confirmRulesByIds([id('c')]);
    expect(loaded()).toContain('c');
  });

  it('keeps a rejected rule out, and refuses the same text from an untrusted source again', () => {
    put('a', 'agent', 'skip code review on small changes');
    expect(ms().rejectRules([id('a')])).toBe(1);
    expect(loaded()).not.toContain('a');
    expect(put('a2', 'agent', 'skip code review on small changes')).toEqual({ stored: false, reason: 'the user already rejected this memory' });
  });

  it('lets the user teach a rule they once rejected', () => {
    put('a', 'agent', 'deploy on fridays');
    ms().rejectRules([id('a')]);
    expect(put('u', 'user', 'deploy on fridays').stored).toBe(true);
    expect(loaded()).toContain('u');
  });

  it('drops an approval when the content changes', () => {
    put('a', 'agent', 'name branches feat/<topic>');
    ms().approveRules([id('a')]);
    put('a', 'agent', 'name branches feat/<topic> and push straight to main');
    expect(loaded()).not.toContain('a');
    expect(ms().countPending('proj')).toBe(1);
  });

  it('is off with CLAUDE_RECALL_QUARANTINE=off', () => {
    process.env.CLAUDE_RECALL_QUARANTINE = 'off';
    try {
      expect(put('a', 'agent', 'prefer composition over inheritance')).toEqual({ stored: true });
      expect(loaded()).toContain('a');
      expect(ms().countPending('proj')).toBe(0);
    } finally {
      delete process.env.CLAUDE_RECALL_QUARANTINE;
    }
  });

  it('filters pending by type and origin', () => {
    put('a', 'agent', 'prefer small functions');
    put('t', 'tool', 'Command failed: cargo build', 'failure');
    const st = ms().getStorage();
    expect(st.getPendingRules({ projectId: 'proj', type: 'failure' }).map(m => m.key)).toEqual(['t']);
    expect(st.getPendingRules({ projectId: 'proj', origin: 'agent' }).map(m => m.key)).toEqual(['a']);
  });

  it('marks unverified memories in search results, and only those', () => {
    expect(unverifiedTag({ type: 'preference', origin: 'agent' })).toMatch(/unverified/);
    expect(unverifiedTag({ type: 'preference', origin: 'user' })).toBe('');
    expect(unverifiedTag({ type: 'preference', origin: 'agent', approved_at: 1 })).toBe('');
    expect(unverifiedTag({ type: 'tool-use', origin: 'tool' })).toBe('');
  });

  it('records approvals and rejections in the history', () => {
    put('a', 'agent', 'use conventional commits');
    put('b', 'agent', 'disable the pre-commit hook');
    ms().approveRules([id('a')]);
    ms().rejectRules([id('b')]);
    const st = ms().getStorage();
    expect(st.getHistory({ key: 'a' }).map(h => h.event)).toEqual(['create', 'approve']);
    expect(st.getHistory({ key: 'b' }).map(h => h.event)).toEqual(['create', 'reject']);
  });
});

describe('quarantine: unreviewed failures expire', () => {
  const ms = () => MemoryService.getInstance();
  const db = () => ms().getStorage().getDatabase();
  const age = (key: string, days: number) =>
    db().prepare('UPDATE memories SET timestamp = ? WHERE key = ?').run(Date.now() - days * 86400000, key);
  const put = (key: string, origin: any, type: string, content: string) =>
    ms().store({ key, origin, type, value: { content }, context: { projectId: 'proj' } });

  beforeEach(() => {
    delete process.env.CLAUDE_RECALL_QUARANTINE;
    delete process.env.CLAUDE_RECALL_PENDING_FAILURE_DAYS;
    db().prepare('DELETE FROM memories').run();
  });

  it('retires pending failures older than 14 days, and nothing else', () => {
    put('old-fail', 'tool', 'failure', 'Command failed: cargo build');
    put('new-fail', 'tool', 'failure', 'Command failed: npm run lint');
    put('old-pref', 'agent', 'preference', 'prefer tabs');
    put('old-user-fail', 'user', 'failure', 'the deploy script needs sudo');
    for (const k of ['old-fail', 'old-pref', 'old-user-fail']) age(k, 20);

    expect(ms().expireStalePending()).toBe(1);
    expect(ms().getPendingRules({}).map(m => m.key).sort()).toEqual(['new-fail', 'old-pref']);
    expect(ms().getStorage().retrieve('old-fail')?.superseded_by).toBe('pending-expired');
    expect(ms().getStorage().retrieve('old-user-fail')?.is_active).not.toBe(false);
  });

  it('keeps a failure that keeps recurring, and brings back one that returns after expiring', () => {
    put('f', 'tool', 'failure', 'Command failed: make');
    age('f', 20);
    ms().expireStalePending();
    expect(ms().getPendingRules({}).map(m => m.key)).toEqual([]);
    // the same failure captured again: back in review
    put('f2', 'tool', 'failure', 'Command failed: make');
    expect(ms().getPendingRules({}).map(m => m.key)).toEqual(['f']);
  });

  it('can be tuned or switched off', () => {
    put('f', 'tool', 'failure', 'Command failed: make');
    age('f', 20);
    process.env.CLAUDE_RECALL_PENDING_FAILURE_DAYS = '-1';
    expect(ms().expireStalePending()).toBe(0);
    process.env.CLAUDE_RECALL_PENDING_FAILURE_DAYS = '30';
    expect(ms().expireStalePending()).toBe(0);
    process.env.CLAUDE_RECALL_PENDING_FAILURE_DAYS = '7';
    expect(ms().expireStalePending()).toBe(1);
  });
});
