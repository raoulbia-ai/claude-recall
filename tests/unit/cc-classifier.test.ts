/**
 * cc-classifier — headless `claude -p` classification on subscription auth.
 *
 * Spawn is mocked with a scriptable fake child, so these cover the process
 * lifecycle (success / none verdict / non-zero exit / ENOENT / timeout) and
 * the two env invariants the whole design hangs on: ANTHROPIC_API_KEY must be
 * STRIPPED from the child env (claude -p would otherwise prefer the key over
 * subscription auth), and CLAUDE_RECALL_CC_CLASSIFIER must be set (recursion
 * guard for hooks fired by the nested session).
 */

import { EventEmitter } from 'events';

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { classifyWithClaudeCli } from '../../src/hooks/cc-classifier';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  kill = jest.fn();
}

function scriptChild(script: (child: FakeChild) => void): FakeChild {
  const child = new FakeChild();
  // Defer so classifyWithClaudeCli has attached its listeners first.
  setImmediate(() => script(child));
  return child;
}

describe('classifyWithClaudeCli', () => {
  const savedKey = process.env.ANTHROPIC_API_KEY;
  const savedTimeout = process.env.CLAUDE_RECALL_CC_LLM_TIMEOUT_MS;

  beforeEach(() => {
    mockSpawn.mockReset();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-should-be-stripped';
    delete process.env.CLAUDE_RECALL_CC_LLM_TIMEOUT_MS;
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedKey;
    if (savedTimeout === undefined) delete process.env.CLAUDE_RECALL_CC_LLM_TIMEOUT_MS;
    else process.env.CLAUDE_RECALL_CC_LLM_TIMEOUT_MS = savedTimeout;
  });

  it('parses a successful classification from claude -p stdout', async () => {
    mockSpawn.mockImplementation(() => scriptChild((c) => {
      c.stdout.emit('data', '{"type":"preference","confidence":0.9,"extract":"Use pnpm, not npm"}\n');
      c.emit('close', 0);
    }));

    const result = await classifyWithClaudeCli('we use pnpm here, not npm');
    expect(result).toEqual({ type: 'preference', confidence: 0.9, extract: 'Use pnpm, not npm' });
  });

  it('strips ANTHROPIC_API_KEY from the child env and sets the recursion guard', async () => {
    mockSpawn.mockImplementation(() => scriptChild((c) => c.emit('close', 0)));

    await classifyWithClaudeCli('we use pnpm here, not npm');

    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args[0]).toBe('-p');
    expect(opts.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(opts.env.CLAUDE_RECALL_CC_CLASSIFIER).toBe('1');
  });

  it('returns null on a deliberate "none" verdict', async () => {
    mockSpawn.mockImplementation(() => scriptChild((c) => {
      c.stdout.emit('data', '{"type":"none","confidence":0,"extract":""}');
      c.emit('close', 0);
    }));

    expect(await classifyWithClaudeCli('no first fix the sentence')).toBeNull();
  });

  it('returns null on a non-zero exit', async () => {
    mockSpawn.mockImplementation(() => scriptChild((c) => c.emit('close', 1)));
    expect(await classifyWithClaudeCli('we use pnpm here, not npm')).toBeNull();
  });

  it('returns null when claude is not on PATH (ENOENT)', async () => {
    mockSpawn.mockImplementation(() => scriptChild((c) => {
      c.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
    }));
    expect(await classifyWithClaudeCli('we use pnpm here, not npm')).toBeNull();
  });

  it('returns null when spawn itself throws', async () => {
    mockSpawn.mockImplementation(() => { throw new Error('EMFILE'); });
    expect(await classifyWithClaudeCli('we use pnpm here, not npm')).toBeNull();
  });

  it('kills the child and returns null on timeout', async () => {
    process.env.CLAUDE_RECALL_CC_LLM_TIMEOUT_MS = '30';
    let child!: FakeChild;
    mockSpawn.mockImplementation(() => {
      child = new FakeChild(); // never emits close — must hit the timeout
      return child;
    });

    const result = await classifyWithClaudeCli('we use pnpm here, not npm');
    expect(result).toBeNull();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
