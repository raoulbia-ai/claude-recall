import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock MemoryService before importing the module under test
const mockStore = jest.fn();
const mockUpdate = jest.fn();
const mockSearch = jest.fn().mockReturnValue([]);

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      store: mockStore,
      update: mockUpdate,
      search: mockSearch,
    }),
  },
}));

jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => 'test-project',
      getDatabasePath: () => ':memory:',
      getConfig: () => ({ database: {} }),
    }),
  },
}));

import { handleBashFailureWatcher, PendingFailure } from '../../src/hooks/bash-failure-watcher';

const STATE_DIR = path.join(os.homedir(), '.claude-recall', 'hook-state');

function statePath(sessionId: string): string {
  return path.join(STATE_DIR, `${sessionId}-failures.json`);
}

describe('bash-failure-watcher', () => {
  const SESSION = 'test-session-123';

  beforeEach(() => {
    jest.clearAllMocks();
    // Clean up state files
    const sp = statePath(SESSION);
    if (fs.existsSync(sp)) fs.unlinkSync(sp);
  });

  afterAll(() => {
    // Cleanup
    const sp = statePath(SESSION);
    if (fs.existsSync(sp)) fs.unlinkSync(sp);
  });

  // --- Failure detection ---

  it('stores failure memory on non-zero exit code', async () => {
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_output: 'Error: some test failed\nExit code 1',
      session_id: SESSION,
    });

    expect(mockStore).toHaveBeenCalledTimes(1);
    const call = mockStore.mock.calls[0][0];
    expect(call.type).toBe('failure');
    expect(call.value.what_failed).toContain('npm test');
    expect(call.value.why_failed).toContain('Exit code 1');
  });

  it('does not store failure on exit code 0', async () => {
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_output: 'All tests passed\nExit code 0',
      session_id: SESSION,
    });

    expect(mockStore).not.toHaveBeenCalled();
  });

  it('does not store failure when output has no exit code pattern', async () => {
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'echo hello' },
      tool_output: 'hello',
      session_id: SESSION,
    });

    expect(mockStore).not.toHaveBeenCalled();
  });

  // --- Dedup ---

  it('skips duplicate failures', async () => {
    // isDuplicate compares input against JSON.stringify(mem.value),
    // so provide a value whose JSON serialization is similar enough to the command
    mockSearch.mockReturnValueOnce([
      { value: 'npm test', score: 0.9 },
    ]);

    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_output: 'Error\nExit code 1',
      session_id: SESSION,
    });

    expect(mockStore).not.toHaveBeenCalled();
  });

  // --- Fix pairing ---

  it('pairs fix when success follows failure with similar command', async () => {
    // First: simulate a failure that wrote state
    const pending: PendingFailure[] = [
      { command: 'npm test', memoryKey: 'hook_failure_123', timestamp: Date.now() },
    ];
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(SESSION), JSON.stringify(pending));

    // Then: success with similar command
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_output: 'All tests passed',
      session_id: SESSION,
    });

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith('hook_failure_123', {
      value: { what_should_do: expect.stringContaining('Fix:') },
    });
  });

  it('does not pair fix for dissimilar commands', async () => {
    const pending: PendingFailure[] = [
      { command: 'npm test', memoryKey: 'hook_failure_456', timestamp: Date.now() },
    ];
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(SESSION), JSON.stringify(pending));

    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
      tool_output: 'On branch main',
      session_id: SESSION,
    });

    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('evicts expired pending failures (> 5 min)', async () => {
    const expired: PendingFailure[] = [
      { command: 'npm test', memoryKey: 'hook_failure_old', timestamp: Date.now() - 6 * 60 * 1000 },
    ];
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(SESSION), JSON.stringify(expired));

    // Success that would match if not expired
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_output: 'All tests passed',
      session_id: SESSION,
    });

    expect(mockUpdate).not.toHaveBeenCalled();

    // State file should have empty array after eviction
    const remaining = JSON.parse(fs.readFileSync(statePath(SESSION), 'utf-8'));
    expect(remaining).toHaveLength(0);
  });

  // --- Edge cases ---

  it('skips hook infrastructure errors', async () => {
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'some command' },
      tool_output: 'PreToolUse:Read hook error\nExit code 1',
      session_id: SESSION,
    });

    expect(mockStore).not.toHaveBeenCalled();
  });

  it('handles empty/missing input gracefully', async () => {
    await expect(handleBashFailureWatcher(null)).resolves.toBeUndefined();
    await expect(handleBashFailureWatcher(undefined)).resolves.toBeUndefined();
    await expect(handleBashFailureWatcher({})).resolves.toBeUndefined();
    await expect(handleBashFailureWatcher({ tool_name: 'Read' })).resolves.toBeUndefined();
  });

  it('skips short commands (< 3 chars)', async () => {
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      tool_output: 'Exit code 1',
      session_id: SESSION,
    });

    expect(mockStore).not.toHaveBeenCalled();
  });

  it('ignores non-Bash tool calls', async () => {
    await handleBashFailureWatcher({
      tool_name: 'Read',
      tool_input: { file_path: '/some/file' },
      tool_output: 'file contents',
      session_id: SESSION,
    });

    expect(mockStore).not.toHaveBeenCalled();
  });

  // --- Max pending limit ---

  it('caps pending failures at 5', async () => {
    // Pre-fill with 5 pending
    const pending: PendingFailure[] = Array.from({ length: 5 }, (_, i) => ({
      command: `cmd-${i}`,
      memoryKey: `key-${i}`,
      timestamp: Date.now(),
    }));
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(statePath(SESSION), JSON.stringify(pending));

    // Add another failure
    mockSearch.mockReturnValueOnce([]);
    await handleBashFailureWatcher({
      tool_name: 'Bash',
      tool_input: { command: 'new failing command' },
      tool_output: 'Error\nExit code 1',
      session_id: SESSION,
    });

    const state = JSON.parse(fs.readFileSync(statePath(SESSION), 'utf-8'));
    expect(state.length).toBeLessThanOrEqual(5);
  });
});
