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

const mockCreateOutcomeEvent = jest.fn().mockReturnValue('event-id');

jest.mock('../../src/services/outcome-storage', () => ({
  OutcomeStorage: {
    getInstance: () => ({
      createOutcomeEvent: mockCreateOutcomeEvent,
    }),
  },
}));

import {
  handleToolOutcomeWatcher,
  handleBashFailureWatcher,
  handleToolFailure,
  PendingFailure,
} from '../../src/hooks/tool-outcome-watcher';

const STATE_DIR = path.join(os.homedir(), '.claude-recall', 'hook-state');

function statePath(sessionId: string): string {
  return path.join(STATE_DIR, `${sessionId}-failures.json`);
}

describe('tool-outcome-watcher', () => {
  const SESSION = 'test-session-tow';

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReturnValue([]);
    const sp = statePath(SESSION);
    if (fs.existsSync(sp)) fs.unlinkSync(sp);
  });

  afterAll(() => {
    const sp = statePath(SESSION);
    if (fs.existsSync(sp)) fs.unlinkSync(sp);
  });

  // --- Backward compatibility ---

  it('exports handleBashFailureWatcher as alias', () => {
    expect(handleBashFailureWatcher).toBe(handleToolOutcomeWatcher);
  });

  // --- Bash regression tests ---

  describe('Bash outcomes', () => {
    it('stores failure memory on non-zero exit code', async () => {
      await handleToolOutcomeWatcher({
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
      await handleToolOutcomeWatcher({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_output: 'All tests passed\nExit code 0',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('skips short commands (< 3 chars)', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
        tool_output: 'Exit code 1',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('skips duplicate failures', async () => {
      mockSearch.mockReturnValueOnce([
        { value: 'npm test', score: 0.9 },
      ]);

      await handleToolOutcomeWatcher({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_output: 'Error\nExit code 1',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('pairs fix when success follows failure with similar command', async () => {
      const pending: PendingFailure[] = [
        { command: 'npm test', memoryKey: 'hook_failure_123', timestamp: Date.now() },
      ];
      if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(statePath(SESSION), JSON.stringify(pending));

      await handleToolOutcomeWatcher({
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

    it('creates outcome event on Bash failure', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
        tool_output: 'Error\nExit code 1',
        session_id: SESSION,
      });

      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'tool_result',
          actor: 'tool',
          tags: expect.arrayContaining(['npm', 'test']),
        })
      );
    });

    it('skips hook infrastructure errors', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Bash',
        tool_input: { command: 'some command' },
        tool_output: 'PreToolUse:Read hook error\nExit code 1',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });
  });

  // --- Edit/Write tool tests ---

  describe('Edit/Write outcomes', () => {
    it('stores failure on permission denied', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Edit',
        tool_input: { file_path: '/etc/hosts', old_string: 'foo', new_string: 'bar' },
        tool_output: 'Error: permission denied for /etc/hosts',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
      const call = mockStore.mock.calls[0][0];
      expect(call.type).toBe('failure');
    });

    it('stores failure on old_string not found', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Edit',
        tool_input: { file_path: '/home/user/app.ts', old_string: 'foo', new_string: 'bar' },
        tool_output: 'The edit will FAIL if old_string is not found in the file',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
    });

    it('stores failure on not unique in the file', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Edit',
        tool_input: { file_path: '/home/user/app.ts', old_string: 'const', new_string: 'let' },
        tool_output: 'The edit will FAIL if old_string is not unique in the file',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
    });

    it('stores failure on Write ENOENT', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Write',
        tool_input: { file_path: '/nonexistent/dir/file.ts' },
        tool_output: 'ENOENT: no such file or directory',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
    });

    it('records outcome event even on success', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Edit',
        tool_input: { file_path: '/home/user/app.ts' },
        tool_output: 'File edited successfully',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'tool_result',
          actor: 'tool',
        })
      );
    });

    it('skips duplicate Edit/Write failures', async () => {
      mockSearch.mockReturnValueOnce([
        { value: 'Edit failed on /etc/hosts: Error: permission denied for /etc/hosts', score: 0.9 },
      ]);

      await handleToolOutcomeWatcher({
        tool_name: 'Edit',
        tool_input: { file_path: '/etc/hosts' },
        tool_output: 'Error: permission denied for /etc/hosts',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });
  });

  // --- MCP tool tests ---

  describe('MCP tool outcomes', () => {
    it('stores failure on MCP tool error', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'mcp__github__create_issue',
        tool_input: { title: 'test' },
        tool_output: 'Error: authentication failed',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
      const call = mockStore.mock.calls[0][0];
      expect(call.type).toBe('failure');
    });

    it('skips claude-recall own tools', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'mcp__claude-recall__store_memory',
        tool_input: { content: 'test' },
        tool_output: 'Error: something went wrong',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
      expect(mockCreateOutcomeEvent).not.toHaveBeenCalled();
    });

    it('skips claude_recall own tools (underscore variant)', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'mcp__claude_recall__load_rules',
        tool_input: {},
        tool_output: 'some result',
        session_id: SESSION,
      });

      expect(mockCreateOutcomeEvent).not.toHaveBeenCalled();
    });

    it('records outcome event for successful MCP calls', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'mcp__github__list_repos',
        tool_input: {},
        tool_output: '["repo1", "repo2"]',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
      expect(mockCreateOutcomeEvent).toHaveBeenCalled();
    });

    it('does not store failure for long MCP output (> 500 chars) even with error keyword', async () => {
      const longOutput = 'This is a normal response with the word error in it. '.repeat(20);
      await handleToolOutcomeWatcher({
        tool_name: 'mcp__some__tool',
        tool_input: {},
        tool_output: longOutput,
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });
  });

  // --- Generic tool tests ---

  describe('Generic tool outcomes', () => {
    it('records outcome event for Read tool', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Read',
        tool_input: { file_path: '/some/file.ts' },
        tool_output: 'file contents here',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'tool_result',
          tags: expect.arrayContaining(['read']),
        })
      );
    });

    it('records outcome event for Grep tool', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Grep',
        tool_input: { pattern: 'TODO', path: '/src' },
        tool_output: 'No matches found',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
      expect(mockCreateOutcomeEvent).toHaveBeenCalled();
    });

    it('does NOT store failure for Grep with no matches', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Grep',
        tool_input: { pattern: 'nonexistent' },
        tool_output: '',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });
  });

  // --- Edge cases ---

  describe('Edge cases', () => {
    it('handles null input gracefully', async () => {
      await expect(handleToolOutcomeWatcher(null)).resolves.toBeUndefined();
    });

    it('handles undefined input gracefully', async () => {
      await expect(handleToolOutcomeWatcher(undefined)).resolves.toBeUndefined();
    });

    it('handles empty object gracefully', async () => {
      await expect(handleToolOutcomeWatcher({})).resolves.toBeUndefined();
    });

    it('handles missing tool_name gracefully', async () => {
      await expect(handleToolOutcomeWatcher({ tool_input: {} })).resolves.toBeUndefined();
    });

    it('handles non-string tool_output gracefully', async () => {
      await handleToolOutcomeWatcher({
        tool_name: 'Read',
        tool_input: { file_path: '/test' },
        tool_output: { some: 'object' },
        session_id: SESSION,
      });

      // Should not throw
      expect(mockCreateOutcomeEvent).toHaveBeenCalled();
    });
  });

  // --- handleToolFailure (PostToolUseFailure) ---

  describe('handleToolFailure', () => {
    it('stores failure with error field for Bash', async () => {
      await handleToolFailure({
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
        error: 'tsc: error TS2322: Type mismatch',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
      const call = mockStore.mock.calls[0][0];
      expect(call.type).toBe('failure');
      // storeMemory wraps in { content, confidence, source, timestamp }
      const content = call.value.content;
      expect(content).toContain('npm run build');
    });

    it('stores failure with file path context for Edit', async () => {
      await handleToolFailure({
        tool_name: 'Edit',
        tool_input: { file_path: '/home/user/app.ts', old_string: 'foo', new_string: 'bar' },
        error: 'old_string not found in file',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
      const content = mockStore.mock.calls[0][0].value.content;
      expect(content).toContain('Edit failed');
      expect(content).toContain('app.ts');
    });

    it('stores failure for generic tool', async () => {
      await handleToolFailure({
        tool_name: 'Glob',
        tool_input: { pattern: '**/*.xyz' },
        error: 'Pattern too broad',
        session_id: SESSION,
      });

      expect(mockStore).toHaveBeenCalledTimes(1);
    });

    it('creates outcome event with tool_failure type', async () => {
      await handleToolFailure({
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/test.ts' },
        error: 'Permission denied',
        session_id: SESSION,
      });

      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'tool_failure',
          actor: 'tool',
        })
      );
    });

    it('skips claude-recall own tools', async () => {
      await handleToolFailure({
        tool_name: 'mcp__claude-recall__store_memory',
        tool_input: {},
        error: 'Some error',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('skips user interrupts', async () => {
      await handleToolFailure({
        tool_name: 'Bash',
        tool_input: { command: 'long running' },
        error: 'User interrupted',
        is_interrupt: true,
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('skips duplicate failures', async () => {
      mockSearch.mockReturnValueOnce([
        { value: 'Bash command failed: npm run build', score: 0.9 },
      ]);

      await handleToolFailure({
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
        error: 'Build failed',
        session_id: SESSION,
      });

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('handles null/empty input gracefully', async () => {
      await expect(handleToolFailure(null)).resolves.toBeUndefined();
      await expect(handleToolFailure({})).resolves.toBeUndefined();
      await expect(handleToolFailure({ tool_name: 'Bash' })).resolves.toBeUndefined();
    });
  });
});
