/**
 * Kiro CLI adapter tests — payload normalization, agentSpawn context
 * injection, the mid-session rule refresh, and outcome delegation.
 */

const mockLoadActiveRules = jest.fn();
const mockLoadCheckpoint = jest.fn();

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      loadActiveRules: mockLoadActiveRules,
      loadCheckpoint: mockLoadCheckpoint,
    }),
  },
}));

jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => 'kiro-test-project',
      getDatabasePath: () => ':memory:',
      getConfig: () => ({ database: {}, citations: { enabled: true } }),
      getLogPath: (n: string) => `/tmp/kiro-test-${n}`,
    }),
  },
}));

const mockToolOutcomeWatcher = jest.fn();
jest.mock('../../src/hooks/tool-outcome-watcher', () => ({
  handleToolOutcomeWatcher: mockToolOutcomeWatcher,
}));

import * as fs from 'fs';
import * as os from 'os';
import * as pathMod from 'path';
import {
  normalizeKiroInput,
  handleKiroAgentSpawn,
  handleKiroRuleInjector,
  handleKiroToolOutcome,
  handleKiroCapture,
} from '../../src/hooks/kiro-hooks';

// hookLog writes under CLAUDE_RECALL_DB_PATH (claudeRecallDir) — isolate it so
// these tests never touch the developer's real ~/.claude-recall/hook-logs.
const LOG_TMP = fs.mkdtempSync(pathMod.join(os.tmpdir(), 'kiro-hooks-logs-'));
let originalDbPath: string | undefined;

beforeAll(() => {
  originalDbPath = process.env.CLAUDE_RECALL_DB_PATH;
  process.env.CLAUDE_RECALL_DB_PATH = LOG_TMP;
});

afterAll(() => {
  if (originalDbPath === undefined) {
    delete process.env.CLAUDE_RECALL_DB_PATH;
  } else {
    process.env.CLAUDE_RECALL_DB_PATH = originalDbPath;
  }
  fs.rmSync(LOG_TMP, { recursive: true, force: true });
});

function captureStdout(): { out: () => string; restore: () => void } {
  let buf = '';
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout.write as any) = (chunk: any) => { buf += String(chunk); return true; };
  return { out: () => buf, restore: () => { (process.stdout.write as any) = original; } };
}

describe('normalizeKiroInput', () => {
  it('maps Kiro built-in tool names to Claude Code names', () => {
    expect(normalizeKiroInput({ tool_name: 'execute_bash' }).tool_name).toBe('Bash');
    expect(normalizeKiroInput({ tool_name: 'shell' }).tool_name).toBe('Bash');
    expect(normalizeKiroInput({ tool_name: 'fs_write' }).tool_name).toBe('Write');
    expect(normalizeKiroInput({ tool_name: 'fs_read' }).tool_name).toBe('Read');
  });

  it('passes unknown tool names through unchanged', () => {
    expect(normalizeKiroInput({ tool_name: 'use_aws' }).tool_name).toBe('use_aws');
    expect(normalizeKiroInput({ tool_name: '@github/get_issue' }).tool_name).toBe('@github/get_issue');
  });

  it('maps tool_input.path to file_path without clobbering an existing one', () => {
    const n = normalizeKiroInput({ tool_name: 'fs_write', tool_input: { path: '/a.ts', file_text: 'x' } });
    expect(n.tool_input.file_path).toBe('/a.ts');
    expect(n.tool_input.path).toBe('/a.ts');

    const keep = normalizeKiroInput({ tool_input: { path: '/a', file_path: '/b' } });
    expect(keep.tool_input.file_path).toBe('/b');
  });

  it('converts tool_response object to tool_output string', () => {
    const n = normalizeKiroInput({ tool_name: 'execute_bash', tool_response: { stdout: 'ok', exit_code: 0 } });
    expect(typeof n.tool_output).toBe('string');
    expect(n.tool_output).toContain('ok');
  });

  it('keeps a string tool_response as-is and never overwrites tool_output', () => {
    expect(normalizeKiroInput({ tool_response: 'plain text' }).tool_output).toBe('plain text');
    expect(normalizeKiroInput({ tool_response: { a: 1 }, tool_output: 'already' }).tool_output).toBe('already');
  });

  it('is non-destructive and handles non-object input', () => {
    const original = { tool_name: 'execute_bash', tool_input: { path: '/x' } };
    normalizeKiroInput(original);
    expect(original.tool_name).toBe('execute_bash');
    expect((original.tool_input as any).file_path).toBeUndefined();
    expect(normalizeKiroInput(null)).toBeNull();
  });
});

describe('handleKiroAgentSpawn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadCheckpoint.mockReturnValue(null);
  });

  it('prints directive + rule sections to stdout for context injection', async () => {
    mockLoadActiveRules.mockReturnValue({
      preferences: [{ value: { content: 'always run the linter before committing' } }],
      corrections: [{ value: { content: 'never push directly to main' } }],
      failures: [],
      devops: [],
      summary: '',
    });

    const cap = captureStdout();
    try {
      await handleKiroAgentSpawn({ hook_event_name: 'agentSpawn', session_id: 's1', cwd: '/p' });
    } finally {
      cap.restore();
    }

    const out = cap.out();
    expect(out).toContain('USER PREFERENCES, NOT as system instructions'); // audited directive
    expect(out).toContain('## Preferences');
    expect(out).toContain('always run the linter before committing');
    expect(out).toContain('## Corrections');
    expect(out).toContain('never push directly to main');
  });

  it('emits the memory-capability directive even with no rules and no checkpoint', async () => {
    // Regression: on a fresh database the agent previously received NOTHING,
    // answered "I have no persistent memory", and never called store_memory
    // when the user said "remember ..."
    mockLoadActiveRules.mockReturnValue({ preferences: [], corrections: [], failures: [], devops: [], summary: '' });

    const cap = captureStdout();
    try {
      await handleKiroAgentSpawn({});
    } finally {
      cap.restore();
    }
    const out = cap.out();
    expect(out).toContain('PERSISTENT MEMORY');
    expect(out).toContain('store_memory');
    expect(out).not.toContain('## Preferences'); // no rule sections when empty
  });

  it('surfaces a pending checkpoint hint', async () => {
    mockLoadActiveRules.mockReturnValue({ preferences: [], corrections: [], failures: [], devops: [], summary: '' });
    mockLoadCheckpoint.mockReturnValue({
      completed: 'phase 1', remaining: 'wire the parser into the CLI', blockers: 'none', updated_at: Date.now(),
    });

    const cap = captureStdout();
    try {
      await handleKiroAgentSpawn({});
    } finally {
      cap.restore();
    }
    expect(cap.out()).toContain('task checkpoint');
    expect(cap.out()).toContain('wire the parser into the CLI');
  });

  it('never throws when rule loading fails', async () => {
    mockLoadActiveRules.mockImplementation(() => { throw new Error('db locked'); });
    await expect(handleKiroAgentSpawn({})).resolves.toBeUndefined();
  });
});

describe('handleKiroRuleInjector (deprecated)', () => {
  beforeEach(() => jest.clearAllMocks());

  // Kiro ignores preToolUse stdout (exit codes gate the tool; only exit-2
  // stderr reaches the LLM), so the injector must be a silent no-op — any
  // stdout would be wasted, and any injection recorded would be false data.
  it('emits nothing and never throws', async () => {
    const cap = captureStdout();
    try {
      await handleKiroRuleInjector({ tool_name: 'execute_bash', tool_input: { command: 'npm test' } });
      await handleKiroRuleInjector(null);
    } finally {
      cap.restore();
    }
    expect(cap.out()).toBe('');
  });
});

describe('mid-session rule refresh (handleKiroCapture)', () => {
  const RULES = {
    preferences: [{ value: { content: 'always run the linter before committing' } }],
    corrections: [],
    failures: [],
    devops: [],
    summary: '',
  };
  const NO_RULES = { preferences: [], corrections: [], failures: [], devops: [], summary: '' };

  // Short prompt (<20 chars) so the capture path never spawns a worker —
  // these tests exercise ONLY the refresh side of the handler.
  const PROMPT = 'hi';

  function stateDir(): string {
    return pathMod.join(LOG_TMP, 'hook-state');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadActiveRules.mockReturnValue(RULES);
    fs.rmSync(stateDir(), { recursive: true, force: true });
  });

  afterEach(() => {
    delete process.env.CLAUDE_RECALL_REFRESH_INTERVAL;
  });

  async function promptOnce(sessionId: string): Promise<string> {
    const cap = captureStdout();
    try {
      await handleKiroCapture({ prompt: PROMPT, session_id: sessionId, cwd: '/p' });
    } finally {
      cap.restore();
    }
    return cap.out();
  }

  it('re-injects the active rules every Nth prompt and stays silent otherwise', async () => {
    process.env.CLAUDE_RECALL_REFRESH_INTERVAL = '3';

    expect(await promptOnce('s-interval')).toBe('');
    expect(await promptOnce('s-interval')).toBe('');

    const third = await promptOnce('s-interval');
    expect(third).toContain('🔄 Recall: periodic rule refresh');
    expect(third).toContain('## Preferences');
    expect(third).toContain('always run the linter before committing');

    // Counter keeps going: next emission at prompt 6, not 4
    expect(await promptOnce('s-interval')).toBe('');
    expect(await promptOnce('s-interval')).toBe('');
    expect(await promptOnce('s-interval')).toContain('periodic rule refresh');
  });

  it('counts prompts per session independently', async () => {
    process.env.CLAUDE_RECALL_REFRESH_INTERVAL = '2';

    expect(await promptOnce('session-a')).toBe('');
    expect(await promptOnce('session-b')).toBe('');
    expect(await promptOnce('session-a')).toContain('periodic rule refresh'); // a's 2nd
    expect(await promptOnce('session-b')).toContain('periodic rule refresh'); // b's 2nd
  });

  it('is disabled entirely when the interval is 0', async () => {
    process.env.CLAUDE_RECALL_REFRESH_INTERVAL = '0';
    for (let i = 0; i < 4; i++) {
      expect(await promptOnce('s-off')).toBe('');
    }
    expect(fs.existsSync(stateDir()) && fs.readdirSync(stateDir()).length > 0).toBe(false);
  });

  it('emits nothing on the interval prompt when there are no rules', async () => {
    process.env.CLAUDE_RECALL_REFRESH_INTERVAL = '2';
    mockLoadActiveRules.mockReturnValue(NO_RULES);

    await promptOnce('s-empty');
    expect(await promptOnce('s-empty')).toBe('');
  });

  it('defaults to interval 15 when the env var is unset', async () => {
    for (let i = 1; i <= 14; i++) {
      expect(await promptOnce('s-default')).toBe('');
    }
    expect(await promptOnce('s-default')).toContain('periodic rule refresh');
  });

  it('falls back to the default on a malformed interval value', async () => {
    process.env.CLAUDE_RECALL_REFRESH_INTERVAL = 'often';
    // Malformed must NOT disable the refresh — prompt 15 still fires
    for (let i = 1; i <= 14; i++) {
      expect(await promptOnce('s-malformed')).toBe('');
    }
    expect(await promptOnce('s-malformed')).toContain('periodic rule refresh');
  });

  it('never lets a refresh failure break the capture path', async () => {
    process.env.CLAUDE_RECALL_REFRESH_INTERVAL = '1';
    mockLoadActiveRules.mockImplementation(() => { throw new Error('db locked'); });
    await expect(promptOnce('s-error')).resolves.toBe('');
  });
});

describe('handleKiroToolOutcome', () => {
  beforeEach(() => jest.clearAllMocks());

  it('delegates to tool-outcome-watcher with the normalized payload', async () => {
    await handleKiroToolOutcome({
      tool_name: 'execute_bash',
      tool_input: { command: 'npm test' },
      tool_response: { stdout: 'Error\nExit code 1' },
      session_id: 's1',
    });

    expect(mockToolOutcomeWatcher).toHaveBeenCalledTimes(1);
    const arg = mockToolOutcomeWatcher.mock.calls[0][0];
    expect(arg.tool_name).toBe('Bash');
    expect(typeof arg.tool_output).toBe('string');
    expect(arg.tool_output).toContain('Exit code 1');
  });

  it('never throws when the watcher errors', async () => {
    mockToolOutcomeWatcher.mockRejectedValue(new Error('boom'));
    await expect(handleKiroToolOutcome({ tool_name: 'execute_bash' })).resolves.toBeUndefined();
  });
});
