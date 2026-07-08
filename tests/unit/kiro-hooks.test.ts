/**
 * Kiro CLI adapter tests — payload normalization, agentSpawn context
 * injection, plain-text rule injection, and outcome delegation.
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

const mockComputeInjection = jest.fn();
jest.mock('../../src/hooks/rule-injector', () => ({
  computeInjection: mockComputeInjection,
}));

const mockToolOutcomeWatcher = jest.fn();
jest.mock('../../src/hooks/tool-outcome-watcher', () => ({
  handleToolOutcomeWatcher: mockToolOutcomeWatcher,
}));

import {
  normalizeKiroInput,
  handleKiroAgentSpawn,
  handleKiroRuleInjector,
  handleKiroToolOutcome,
} from '../../src/hooks/kiro-hooks';

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

  it('prints nothing when there are no rules and no checkpoint', async () => {
    mockLoadActiveRules.mockReturnValue({ preferences: [], corrections: [], failures: [], devops: [], summary: '' });

    const cap = captureStdout();
    try {
      await handleKiroAgentSpawn({});
    } finally {
      cap.restore();
    }
    expect(cap.out()).toBe('');
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

describe('handleKiroRuleInjector', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits plain text (no hookSpecificOutput envelope) with normalized tool name', async () => {
    mockComputeInjection.mockResolvedValue('<recalled-memory>rule text</recalled-memory>');

    const cap = captureStdout();
    try {
      await handleKiroRuleInjector({ tool_name: 'execute_bash', tool_input: { command: 'npm test' } });
    } finally {
      cap.restore();
    }

    expect(mockComputeInjection).toHaveBeenCalledWith('Bash', { command: 'npm test' }, '');
    expect(cap.out()).toContain('<recalled-memory>rule text</recalled-memory>');
    expect(cap.out()).not.toContain('hookSpecificOutput');
  });

  it('emits nothing when there is no injection', async () => {
    mockComputeInjection.mockResolvedValue(null);
    const cap = captureStdout();
    try {
      await handleKiroRuleInjector({ tool_name: 'fs_read', tool_input: { path: '/x' } });
    } finally {
      cap.restore();
    }
    expect(cap.out()).toBe('');
  });

  it('never throws when the core errors', async () => {
    mockComputeInjection.mockRejectedValue(new Error('boom'));
    await expect(handleKiroRuleInjector({ tool_name: 'execute_bash' })).resolves.toBeUndefined();
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
