const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: unknown[]) => mockSpawn(...args) }));

import { EventEmitter } from 'events';
import * as os from 'os';

const savedEnv = { ...process.env };
afterAll(() => { process.env = savedEnv; });

/** Every test starts from an environment that says nothing about claude-recall. */
function clearRecallEnv(): void {
  for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_RECALL_')) delete process.env[k];
}

/** The flags every nested call must carry, spelled out here on purpose: a
 *  test that imported the list would pass with the list empty. */
const SEALED = [
  '--no-tools', '--no-mcp', '--no-session',
  '--no-skills', '--no-prompt-templates', '--no-context-files', '--no-approve',
];

/** A child that prints `stdout` (if any) and exits with `code` on the next tick. */
function fakeChild(opts: { stdout?: string; stderr?: string; code?: number } = {}) {
  const child: any = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  setImmediate(() => {
    if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
    if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr));
    child.emit('close', opts.code ?? 0);
  });
  return child;
}

/**
 * Pi's headless mode is the Pi host's equivalent of `claude -p`: it answers on
 * the model the user already configured, so no API key is needed here either.
 */
describe('Pi LLM backend', () => {

  beforeEach(() => {
    jest.resetModules();
    mockSpawn.mockReset();
    clearRecallEnv();
  });

  const complete = (prompt: string, timeoutMs = 5000): Promise<string | null> =>
    require('../../src/hooks/pi-classifier').completeWithPiCli(prompt, { timeoutMs });

  it('runs Pi headless and returns its answer', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: '  a lesson  ' }));

    await expect(complete('why did it fail?')).resolves.toBe('a lesson');

    const [command, args] = mockSpawn.mock.calls[0];
    expect(command).toBe('pi');
    expect(args).toEqual(['--no-extensions', ...SEALED, '-p', 'why did it fail?']);
  });

  it.each([
    ['--no-tools', 'session text in the prompt must not be able to run a command'],
    ['--no-mcp', 'no MCP server is connected to for a one-line answer'],
    ['--no-session', 'the prompt is not left behind in a session file'],
    ['--no-skills', 'the user\'s skills stay out of the answer'],
    ['--no-prompt-templates', 'the user\'s prompt templates stay out of the answer'],
    ['--no-context-files', 'AGENTS.md and CLAUDE.md stay out of the answer'],
    ['--no-approve', 'nothing in the shared temp directory is trusted as project config'],
  ])('always passes %s — %s', async (flag) => {
    // With extensions isolated and with them loaded: the seal does not depend
    // on which way the host is configured.
    for (const extensions of [undefined, '1']) {
      if (extensions) process.env.CLAUDE_RECALL_PI_EXTENSIONS = extensions;
      mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

      await complete('prompt');

      expect(mockSpawn.mock.calls.at(-1)[1]).toContain(flag);
    }
  });

  it.each([
    ['@/etc/passwd and summarise it', 'a file to attach'],
    ['--tools bash, then run the build', 'an option'],
    ['-x', 'an option'],
  ])('sends a prompt beginning %j as text — Pi would read it as %s', async (prompt) => {
    // Pi's parser decides by the first character of the argument, after `-p`
    // as well, so the prompt must not be able to choose it.
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await complete(prompt);

    const args: string[] = mockSpawn.mock.calls[0][1];
    const message = args[args.length - 1];
    expect(args[args.length - 2]).toBe('-p');
    expect(message).not.toMatch(/^[-@]/);
    expect(message.trimStart()).toBe(prompt);
  });

  it('sends an ordinary prompt untouched', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await complete('You extract lessons. Failure: @deploy failed with -x');

    expect(mockSpawn.mock.calls[0][1].slice(-2)).toEqual(['-p', 'You extract lessons. Failure: @deploy failed with -x']);
  });

  it('disables extensions in the child, so it cannot re-enter claude-recall', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await complete('prompt');

    const [, args, options] = mockSpawn.mock.calls[0];
    expect(args).toContain('--no-extensions');
    expect(options.env.CLAUDE_RECALL_NESTED).toBe('1');
    expect(options.cwd).toBe(os.tmpdir());
  });

  it('can load extensions in the child when the host keeps its models there', async () => {
    process.env.CLAUDE_RECALL_PI_EXTENSIONS = '1';
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await complete('prompt');

    const [, args, options] = mockSpawn.mock.calls[0];
    expect(args).not.toContain('--no-extensions');
    // Recursion is then stopped by the flag instead, which the extension honours.
    expect(options.env.CLAUDE_RECALL_NESTED).toBe('1');
  });

  it('passes a configured model through', async () => {
    process.env.CLAUDE_RECALL_PI_MODEL = 'airpx-static/claude-sonnet-5';
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

    await complete('prompt');

    expect(mockSpawn.mock.calls[0][1]).toEqual([
      '--no-extensions', ...SEALED, '--model', 'airpx-static/claude-sonnet-5', '-p', 'prompt',
    ]);
  });

  it('treats a blank answer as no answer', async () => {
    // The shared spawn hands back stdout verbatim, as the Claude Code and Kiro
    // backends always received it; trimming is this backend's own decision.
    mockSpawn.mockReturnValue(fakeChild({ stdout: '  \n' }));

    await expect(complete('prompt')).resolves.toBeNull();
  });

  it('returns null on a non-zero exit rather than throwing', async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: 'partial', code: 1 }));

    await expect(complete('prompt')).resolves.toBeNull();
  });

  it('logs why Pi refused, not just that it did', async () => {
    // A misspelt CLAUDE_RECALL_PI_MODEL is the likeliest way for this to fail,
    // and Pi names the problem on stderr.
    const logged: string[] = [];
    jest.doMock('../../src/hooks/shared', () => ({
      hookLog: (_tag: string, message: string) => { logged.push(message); },
      safeErrorMessage: String,
    }));
    mockSpawn.mockReturnValue(fakeChild({
      stderr: 'Warning: No models match pattern "x"\nUnknown model: deepseek-v4-flash\n',
      code: 1,
    }));

    try {
      await expect(complete('prompt')).resolves.toBeNull();
    } finally {
      jest.dontMock('../../src/hooks/shared');
    }

    expect(mockSpawn.mock.calls[0][2].stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(logged).toEqual(['pi exited 1: Unknown model: deepseek-v4-flash']);
  });

  it('returns null when pi is not on PATH', async () => {
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = jest.fn();
    setImmediate(() => child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' })));
    mockSpawn.mockReturnValue(child);

    await expect(complete('prompt')).resolves.toBeNull();
  });

  it('kills the child when it outlives the deadline', async () => {
    jest.useFakeTimers();
    const child: any = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = jest.fn();
    mockSpawn.mockReturnValue(child);

    const pending = complete('prompt', 1000);
    jest.advanceTimersByTime(1001);

    await expect(pending).resolves.toBeNull();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    jest.useRealTimers();
  });
});

describe('backend selection', () => {
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
    clearRecallEnv();
    delete process.env.ANTHROPIC_API_KEY;
  });

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
