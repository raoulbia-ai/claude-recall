import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryService } from '../../src/services/memory';
import { handleReviewInput } from '../../src/shared/review-command';

/**
 * In-session review: what the USER types ("recall review", then y/n/s/all/q)
 * is handled before the agent sees it.
 */
describe('in-session review (handleReviewInput)', () => {
  let stateDir: string;
  const ms = () => MemoryService.getInstance();
  const id = (key: string) => (ms().getStorage().retrieve(key) as any).id as number;
  const say = (text: string, session = 's1') => handleReviewInput(text, session, stateDir);
  const pendingKeys = () => ms().getPendingRules({}).map(m => m.key).sort();
  const put = (key: string, content: string) =>
    ms().store({ key, origin: 'agent', type: 'preference', value: { content } });

  beforeEach(() => {
    delete process.env.CLAUDE_RECALL_QUARANTINE;
    ms().getStorage().getDatabase().prepare('DELETE FROM memories').run();
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-review-'));
    put('m1', 'prefer small pull requests');
    put('m2', 'skip code review on fridays');
    put('m3', 'use conventional commits');
  });
  afterEach(() => fs.rmSync(stateDir, { recursive: true, force: true }));

  it('lets ordinary prompts through untouched', () => {
    expect(say('please refactor the parser')).toBeNull();
    expect(say('y')).toBeNull(); // no review running: a bare "y" is for the agent
  });

  it('steps through one at a time: approve, reject, skip', () => {
    const first = say('recall review')!;
    expect(first).toMatch(/3 memories to review/);
    expect(first).toMatch(/\[1\/3\]/);
    expect(first).toMatch(/Reply: y = approve/);

    // Newest first: m3, m2, m1
    expect(say('y')).toMatch(/\[2\/3\]/);
    expect(say('n')).toMatch(/\[3\/3\]/);
    expect(say('s')).toMatch(/Review done: 1 approved, 1 rejected/);

    expect(pendingKeys()).toEqual(['m1']);
    expect(ms().loadActiveRules().preferences.map(m => m.key)).toEqual(['m3']);
  });

  it('shows the stored text itself', () => {
    const msg = say('recall review')!;
    expect(msg).toContain('use conventional commits');
    expect(msg).toMatch(/stored by the agent/);
    // and what approving it would do
    expect(msg).toMatch(/approve → the agent follows this as your preference/);
  });

  it('says what approving a failure means, and that a non-failure should be rejected', () => {
    ms().getStorage().getDatabase().prepare('DELETE FROM memories').run();
    ms().store({ key: 'f1', origin: 'tool', type: 'failure', value: { content: 'Command failed: cargo build' } });
    const msg = say('recall review')!;
    expect(msg).toMatch(/captured from tool output/);
    expect(msg).toMatch(/past mistake to avoid\. Reject it if nothing really went wrong/);
  });

  it('takes several answers at once, in order', () => {
    say('recall review');
    // newest first: m3 rejected (n), m2 approved (y), m1 skipped (s)
    expect(say('nys')).toBeDefined();
    expect(pendingKeys()).toEqual(['m1']);
    expect(ms().loadActiveRules().preferences.map(m => m.key)).toEqual(['m2']);
  });

  it('accepts spaced or comma-separated batches, and ignores answers past the end', () => {
    say('recall review');
    expect(say('y, y')).toMatch(/\[3\/3\]/);
    expect(say('y n n')).toMatch(/2 extra answers ignored[\s\S]*Review done: 3 approved/);
  });

  it('does not treat an ordinary word as a batch', () => {
    say('recall review');
    expect(say('yes please refactor')).toBeNull();
  });

  it('approves everything left with "all"', () => {
    say('recall review');
    say('n');
    expect(say('all')).toMatch(/Review done: 2 approved, 1 rejected/);
    expect(pendingKeys()).toEqual([]);
  });

  it('stops on "q", and an ordinary prompt also ends the review', () => {
    say('recall review');
    expect(say('q')).toMatch(/Review stopped/);
    expect(say('y')).toBeNull();

    say('recall review');
    expect(say('ok now fix the failing test')).toBeNull();
    expect(say('y')).toBeNull();
    expect(pendingKeys()).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps reviews of different sessions apart', () => {
    say('recall review', 'A');
    expect(say('y', 'B')).toBeNull();
    expect(say('y', 'A')).toMatch(/\[2\/3\]/);
  });

  it('approves or rejects by id, and everything with "all"', () => {
    expect(say(`recall approve ${id('m1')} ${id('m2')}`)).toMatch(/Approved 2 memories/);
    expect(say(`recall reject ${id('m3')}`)).toMatch(/Rejected 1 memory/);
    expect(pendingKeys()).toEqual([]);

    put('m4', 'name branches feat/x');
    expect(say('recall approve all')).toMatch(/Approved 1 memory/);
  });

  it('lists pending memories with their ids', () => {
    const msg = say('recall pending')!;
    expect(msg).toMatch(/3 waiting for review/);
    expect(msg).toContain(`#${id('m2')}`);
  });

  it('asks for ids rather than guessing', () => {
    expect(say('recall approve')).toMatch(/Name the memories/);
  });

  it('"recall rules" shows the loaded rules without counting it as a load', () => {
    ms().store({ key: 'u1', origin: 'user', type: 'preference', value: { content: 'use pnpm, not npm' } });
    const msg = say('recall rules')!;
    expect(msg).toMatch(/1 rule for/);
    expect(msg).toContain('use pnpm, not npm');
    expect(msg).not.toContain('prefer small pull requests'); // still pending
    expect(msg).toMatch(/3 more waiting for your review/);
    expect((ms().getStorage().retrieve('u1') as any).load_count || 0).toBe(0);
  });

  it('"recall rules" shows mistakes to avoid in full and includes project notes', () => {
    ms().store({ key: 'f9', origin: 'user', type: 'failure', value: {
      what_failed: 'Reported the release as published too early',
      why_failed: 'CI went green before npm had the new version',
      what_should_do: 'Poll npm view until it returns the new version',
    } });
    ms().store({ key: 'n9', origin: 'user', type: 'project-knowledge', value: { content: 'commit only tracked files' } });
    const msg = say('recall rules')!;
    expect(msg).toMatch(/Mistakes to avoid \(1\)/);
    expect(msg).toMatch(/why: CI went green/);
    expect(msg).toMatch(/instead: Poll npm view/);
    expect(msg).toMatch(/Project notes \(given when relevant\) \(1\)[\s\S]*commit only tracked files/);
    expect(msg).toMatch(/2 rules for/);
    expect(msg).toMatch(/recall reject <id>/);
  });

  it('"recall knowledge" lists approved project facts only', () => {
    ms().store({ key: 'k1', origin: 'user', type: 'project-knowledge', value: { content: 'the API lives in services/api' } });
    ms().store({ key: 'k2', origin: 'agent', type: 'project-knowledge', value: { content: 'the db is postgres 15' } });
    const msg = say('recall knowledge')!;
    expect(msg).toMatch(/1 fact kept/);
    expect(msg).toContain('the API lives in services/api');
    expect(msg).not.toContain('postgres'); // waiting for review
  });

  it('says so when there are no rules or facts', () => {
    ms().getStorage().getDatabase().prepare('DELETE FROM memories').run();
    expect(say('recall rules')).toMatch(/No rules yet/);
    expect(say('recall knowledge')).toMatch(/No project knowledge/);
  });

  it('says so when nothing is waiting', () => {
    ms().getStorage().getDatabase().prepare('DELETE FROM memories').run();
    expect(say('recall review')).toMatch(/Nothing waiting/);
  });
});
