/**
 * cc-capture — the Claude Code detached-worker capture spawner.
 *
 * The critical property is the RECURSION GUARD: the worker classifies via a
 * nested headless `claude -p` session, and if that session fires claude-recall
 * hooks of its own (user-level settings), handleCcCapture must refuse to spawn
 * another worker — otherwise every classify call spawns a classify call.
 */

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

import { handleCcCapture } from '../../src/hooks/cc-capture';

function fakeChild() {
  return {
    on: jest.fn(),
    stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
    unref: jest.fn(),
    pid: 12345,
  };
}

describe('handleCcCapture', () => {
  const saved = {
    cc: process.env.CLAUDE_RECALL_CC_CLASSIFIER,
    kiro: process.env.CLAUDE_RECALL_KIRO_CLASSIFIER,
  };
  const PROMPT = { prompt: 'we use pnpm here, not npm — always' };

  beforeEach(() => {
    mockSpawn.mockReset().mockReturnValue(fakeChild());
    delete process.env.CLAUDE_RECALL_CC_CLASSIFIER;
    delete process.env.CLAUDE_RECALL_KIRO_CLASSIFIER;
  });
  afterAll(() => {
    if (saved.cc === undefined) delete process.env.CLAUDE_RECALL_CC_CLASSIFIER;
    else process.env.CLAUDE_RECALL_CC_CLASSIFIER = saved.cc;
    if (saved.kiro === undefined) delete process.env.CLAUDE_RECALL_KIRO_CLASSIFIER;
    else process.env.CLAUDE_RECALL_KIRO_CLASSIFIER = saved.kiro;
  });

  it('spawns a detached cc-capture-worker and pipes the payload over stdin', async () => {
    await handleCcCapture(PROMPT);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, args, opts] = mockSpawn.mock.calls[0];
    expect(args).toContain('cc-capture-worker');
    expect(opts.detached).toBe(true);
    const child = mockSpawn.mock.results[0].value;
    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(PROMPT));
    expect(child.unref).toHaveBeenCalled();
  });

  it('refuses to spawn from inside a CC classifier session (recursion guard)', async () => {
    process.env.CLAUDE_RECALL_CC_CLASSIFIER = '1';
    await handleCcCapture(PROMPT);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('refuses to spawn from inside a Kiro classifier session (recursion guard)', async () => {
    process.env.CLAUDE_RECALL_KIRO_CLASSIFIER = '1';
    await handleCcCapture(PROMPT);
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('skips trivial input without spawning (mirrors correction-detector pre-checks)', async () => {
    await handleCcCapture({ prompt: 'short' });
    await handleCcCapture({ prompt: '```' + 'x'.repeat(30) });
    await handleCcCapture({ prompt: '{"json": "' + 'x'.repeat(30) + '"}' });
    await handleCcCapture({ prompt: 'x'.repeat(2001) });
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
