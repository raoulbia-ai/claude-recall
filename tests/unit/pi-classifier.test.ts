const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: unknown[]) => mockSpawn(...args) }));

import { EventEmitter } from 'events';
import * as os from 'os';

/** A child that prints `stdout` (if any) and exits with `code` on the next tick. */
function fakeChild(opts: { stdout?: string; code?: number } = {}) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
    child.emit('close', opts.code ?? 0);
  });
  return child;
}

/**
 * Pi's headless mode is the Pi host's equivalent of `claude -p`: it answers on
 * the model the user already configured, so no API key is needed here either.
 */
describe('Pi LLM backend', () => {
  const prev = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    mockSpawn.mockReset();
    for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_RECALL_')) delete process.env[k];
  });

  afterAll(() => { process.env = prev; });

  const load = () => require('../../src/hooks/pi-classifier');

  it('runs Pi headless and returns its answer', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: '  a lesson  ' }));

    await expect(load().completeWithPiCli('why did it fail?')).resolves.toBe('a lesson');

    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe('pi');
    expect(args).toEqual(['--no-extensions', '-p', 'why did it fail?']);
  });

  it('disables extensions in the child, so it cannot re-enter claude-recall', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await load().completeWithPiCli('prompt');

    const [, args, options] = mockSpawn.mock.calls[0];
    expect(args).toContain('--no-extensions');
    expect(options.env.CLAUDE_RECALL_NESTED).toBe('1');
    expect(options.cwd).toBe(os.tmpdir());
  });

  it('can load extensions in the child when the host keeps its models there', async () => {
    process.env.CLAUDE_RECALL_PI_EXTENSIONS = '1';
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await load().completeWithPiCli('prompt');

    const [, args, options] = mockSpawn.mock.calls[0];
    expect(args).not.toContain('--no-extensions');
    // Recursion is then stopped by the flag instead, which the extension honours.
    expect(options.env.CLAUDE_RECALL_NESTED).toBe('1');
  });

  it('passes a configured model through', async () => {
    process.env.CLAUDE_RECALL_PI_MODEL = 'airpx-static/claude-sonnet-5';
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await load().completeWithPiCli('prompt');

    expect(mockSpawn.mock.calls[0][1]).toEqual([
      '--no-extensions', '--model', 'airpx-static/claude-sonnet-5', '-p', 'prompt',
    ]);
  });

  it('treats a blank answer as no answer', async () => {
    // The shared spawn hands back stdout verbatim, as the Claude Code and Kiro
    // backends always received it; trimming is this backend's own decision.
    mockSpawn.mockReturnValue(fakeChild({ stdout: '  \n' }));

    await expect(load().completeWithPiCli('prompt')).resolves.toBeNull();
  });

  it('returns null on a non-zero exit rather than throwing', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'partial', code: 1 }));

    await expect(load().completeWithPiCli('prompt')).resolves.toBeNull();
  });

  it('returns null when pi is not on PATH', async () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = jest.fn();
    setImmediate(() => child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' })));
    mockSpawn.mockReturnValue(child);

    await expect(load().completeWithPiCli('prompt')).resolves.toBeNull();
  });

  it('kills the child when it outlives the deadline', async () => {
    jest.useFakeTimers();
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = jest.fn();
    mockSpawn.mockReturnValue(child);

    const pending = load().completeWithPiCli('prompt', { timeoutMs: 1000 });
    jest.advanceTimersByTime(1001);

    await expect(pending).resolves.toBeNull();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    jest.useRealTimers();
  });
});

describe('backend selection', () => {
  const prev = { ...process.env };
  const HINT = JSON.stringify({ hint_text: 'check the path first', hint_kind: 'failure_preventer', applies_when: ['fs'] });

  /** `claude` is absent (exits non-zero); `pi` answers. */
  const claudeMissingPiAnswers = (command: string) =>
    command === 'pi' ? fakeChild({ stdout: HINT }) : fakeChild({ code: 127 });

  const spawned = (): string[] => mockSpawn.mock.calls.map(([command]: [string]) => command);

  /** Ask for a completion, as a process that is — or is not — a Pi host. */
  function askForHint(opts: { piHost: boolean }) {
    if (opts.piHost) require('../../src/hooks/pi-classifier').announcePiHost();
    return require('../../src/hooks/llm-classifier').extractHindsightHint('failed', 'context');
  }

  beforeEach(() => {
    jest.resetModules();
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(claudeMissingPiAnswers);
    for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_RECALL_')) delete process.env[k];
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(() => { process.env = prev; });

  it('falls through to Pi on a Pi host that opted in', async () => {
    process.env.CLAUDE_RECALL_PI_LLM = '1';

    await expect(askForHint({ piHost: true })).resolves.toMatchObject({ hint_text: 'check the path first' });

    // Claude Code's own CLI keeps its place at the front; Pi is the fallback.
    expect(spawned()).toEqual(['claude', 'pi']);
  });

  it('stays off on a Pi host that did not opt in', async () => {
    // Paid calls and session text to the user's provider are theirs to switch on.
    await expect(askForHint({ piHost: true })).resolves.toBeNull();

    expect(spawned()).toEqual(['claude']);
  });

  it('does not take the word of the environment for being a Pi host', async () => {
    // Everything Pi spawns inherits its environment — a `claude` session started
    // from Pi's bash tool included. Its hooks must not be answered by Pi.
    process.env.CLAUDE_RECALL_PI_LLM = '1';
    process.env.CLAUDE_RECALL_RUNTIME = 'pi';

    await expect(askForHint({ piHost: false })).resolves.toBeNull();

    expect(spawned()).toEqual(['claude']);
  });

  it('spawns nothing from inside a nested session', async () => {
    process.env.CLAUDE_RECALL_PI_LLM = '1';
    process.env.CLAUDE_RECALL_NESTED = '1';

    await expect(askForHint({ piHost: true })).resolves.toBeNull();

    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
