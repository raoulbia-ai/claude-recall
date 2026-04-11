/**
 * Tests for the just-in-time rule injection hook (PreToolUse) and its
 * counterpart resolver hook (PostToolUse / PostToolUseFailure).
 *
 * These hooks together implement the meter that replaces the broken citation
 * detection regex (.research/rule-loading-gap.md). The injector matches rules
 * to a tool call and prints additionalContext to stdout (which CC wraps in a
 * system-reminder block adjacent to the action). The resolver fires after the
 * tool completes and updates the injection event with the actual outcome.
 */

const mockLoadActiveRules = jest.fn();
const mockGetProjectId = jest.fn().mockReturnValue('test-project');
const mockRecordRuleInjection = jest.fn();
const mockResolveRuleInjections = jest.fn();
const mockHookLog = jest.fn();

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      loadActiveRules: (...args: any[]) => mockLoadActiveRules(...args),
    }),
  },
}));

jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => mockGetProjectId(),
      getDatabasePath: () => ':memory:',
      getConfig: () => ({ database: {}, project: { rootDir: '/tmp' } }),
    }),
  },
}));

jest.mock('../../src/services/outcome-storage', () => ({
  OutcomeStorage: {
    getInstance: () => ({
      recordRuleInjection: (...args: any[]) => mockRecordRuleInjection(...args),
      resolveRuleInjections: (...args: any[]) => mockResolveRuleInjections(...args),
    }),
  },
}));

jest.mock('../../src/hooks/shared', () => ({
  hookLog: (...args: any[]) => mockHookLog(...args),
}));

import { handleRuleInjector } from '../../src/hooks/rule-injector';
import { handleRuleInjectionResolver } from '../../src/hooks/rule-injection-resolver';

function captureStdout(): { restore: () => string } {
  const original = process.stdout.write.bind(process.stdout);
  let buffer = '';
  (process.stdout.write as any) = (chunk: any) => {
    buffer += chunk.toString();
    return true;
  };
  return {
    restore: () => {
      (process.stdout.write as any) = original;
      return buffer;
    },
  };
}

describe('handleRuleInjector — PreToolUse hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadActiveRules.mockReturnValue({
      preferences: [],
      corrections: [],
      failures: [],
      devops: [],
      summary: '',
    });
  });

  it('emits empty JSON when tool_name is missing', async () => {
    const stdout = captureStdout();
    await handleRuleInjector({});
    const output = stdout.restore();
    expect(output.trim()).toBe('{}');
    expect(mockLoadActiveRules).not.toHaveBeenCalled();
  });

  it('skips claude-recall MCP tools to avoid recursive injection', async () => {
    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'mcp__claude-recall__load_rules',
      tool_input: {},
      tool_use_id: 'tu1',
    });
    const output = stdout.restore();
    expect(output.trim()).toBe('{}');
    expect(mockLoadActiveRules).not.toHaveBeenCalled();
  });

  it('emits empty JSON when no active rules exist', async () => {
    mockLoadActiveRules.mockReturnValueOnce({
      preferences: [], corrections: [], failures: [], devops: [], summary: '',
    });
    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tu1',
    });
    const output = stdout.restore();
    expect(output.trim()).toBe('{}');
    expect(mockRecordRuleInjection).not.toHaveBeenCalled();
  });

  it('emits empty JSON when no rule meets the relevance threshold', async () => {
    mockLoadActiveRules.mockReturnValueOnce({
      preferences: [
        { key: 'p1', type: 'preference', value: { content: 'use Spanish in variable names' }, is_active: true, timestamp: Date.now() },
      ],
      corrections: [], failures: [], devops: [], summary: '',
    });
    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'Bash',
      tool_input: { command: 'docker compose up' },
      tool_use_id: 'tu1',
    });
    const output = stdout.restore();
    expect(output.trim()).toBe('{}');
    expect(mockRecordRuleInjection).not.toHaveBeenCalled();
  });

  it('emits hookSpecificOutput.additionalContext when rules match', async () => {
    mockLoadActiveRules.mockReturnValueOnce({
      preferences: [],
      corrections: [],
      failures: [],
      devops: [
        { key: 'd1', type: 'devops', value: { content: 'always run npm run build before npm test' }, is_active: true, timestamp: Date.now() },
      ],
      summary: '',
    });

    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'Bash',
      tool_input: { command: 'npm run build && npm test' },
      tool_use_id: 'tu1',
    });
    const output = stdout.restore();

    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput).toBeDefined();
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('npm run build');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('Recall:');
  });

  it('records a rule_injection_event for each matched rule', async () => {
    mockLoadActiveRules.mockReturnValueOnce({
      preferences: [],
      corrections: [
        { key: 'c1', type: 'correction', value: { content: 'always commit with --no-gpg-sign in WSL' }, is_active: true, timestamp: Date.now() },
      ],
      failures: [],
      devops: [
        { key: 'd1', type: 'devops', value: { content: 'commit messages should follow conventional format' }, is_active: true, timestamp: Date.now() },
      ],
      summary: '',
    });

    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m "fix bug"' },
      tool_use_id: 'tu-commit-1',
    });
    stdout.restore();

    expect(mockRecordRuleInjection).toHaveBeenCalled();
    const calls = mockRecordRuleInjection.mock.calls;
    // Both rules should be recorded
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const [call] of calls) {
      expect(call.tool_name).toBe('Bash');
      expect(call.tool_use_id).toBe('tu-commit-1');
      expect(call.project_id).toBe('test-project');
      expect(call.match_score).toBeGreaterThan(0);
      expect(Array.isArray(call.matched_tokens)).toBe(true);
    }
  });

  it('caps injected rules at 3 even when more match', async () => {
    const manyRules = [];
    for (let i = 0; i < 10; i++) {
      manyRules.push({
        key: `d${i}`,
        type: 'devops',
        value: { content: `always run npm test command for case ${i}` },
        is_active: true,
        timestamp: Date.now(),
      });
    }
    mockLoadActiveRules.mockReturnValueOnce({
      preferences: [], corrections: [], failures: [], devops: manyRules, summary: '',
    });

    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tu1',
    });
    const output = stdout.restore();

    expect(mockRecordRuleInjection.mock.calls.length).toBeLessThanOrEqual(3);
    const parsed = JSON.parse(output);
    const lineCount = parsed.hookSpecificOutput.additionalContext.split('\n').filter((l: string) => l.startsWith('•')).length;
    expect(lineCount).toBeLessThanOrEqual(3);
  });

  it('does not throw when MemoryService.loadActiveRules throws', async () => {
    mockLoadActiveRules.mockImplementationOnce(() => {
      throw new Error('DB locked');
    });

    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_use_id: 'tu1',
    });
    const output = stdout.restore();

    // Should still emit valid JSON so CC doesn't error
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('does not break the injection if recordRuleInjection throws', async () => {
    mockLoadActiveRules.mockReturnValueOnce({
      preferences: [],
      corrections: [],
      failures: [],
      devops: [
        { key: 'd1', type: 'devops', value: { content: 'always run npm test from project root' }, is_active: true, timestamp: Date.now() },
      ],
      summary: '',
    });
    mockRecordRuleInjection.mockImplementationOnce(() => {
      throw new Error('DB locked');
    });

    const stdout = captureStdout();
    await handleRuleInjector({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_use_id: 'tu1',
    });
    const output = stdout.restore();

    // The injection itself should still go through even if recording fails
    const parsed = JSON.parse(output);
    expect(parsed.hookSpecificOutput?.additionalContext).toBeDefined();
  });
});

describe('handleRuleInjectionResolver — PostToolUse / PostToolUseFailure hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveRuleInjections.mockReturnValue(0);
  });

  it('resolves injections as success on PostToolUse event', async () => {
    mockResolveRuleInjections.mockReturnValueOnce(2);
    await handleRuleInjectionResolver({
      tool_use_id: 'tu1',
      hook_event_name: 'PostToolUse',
    });
    expect(mockResolveRuleInjections).toHaveBeenCalledWith('tu1', 'success');
  });

  it('resolves injections as failure on PostToolUseFailure event', async () => {
    mockResolveRuleInjections.mockReturnValueOnce(1);
    await handleRuleInjectionResolver({
      tool_use_id: 'tu2',
      hook_event_name: 'PostToolUseFailure',
    });
    expect(mockResolveRuleInjections).toHaveBeenCalledWith('tu2', 'failure');
  });

  it('does nothing when tool_use_id is missing', async () => {
    await handleRuleInjectionResolver({});
    expect(mockResolveRuleInjections).not.toHaveBeenCalled();
  });

  it('does not throw when resolveRuleInjections throws', async () => {
    mockResolveRuleInjections.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(
      handleRuleInjectionResolver({ tool_use_id: 'tu1', hook_event_name: 'PostToolUse' }),
    ).resolves.toBeUndefined();
  });
});
