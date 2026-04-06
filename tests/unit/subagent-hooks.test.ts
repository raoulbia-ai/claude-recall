/**
 * Tests for sub-agent hooks — SubagentStart and SubagentStop.
 */

const mockLoadActiveRules = jest.fn().mockReturnValue({
  preferences: [], corrections: [], failures: [], devops: [], summary: '',
});

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      loadActiveRules: mockLoadActiveRules,
    }),
  },
}));

jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => 'test-project',
      getDatabasePath: () => ':memory:',
      getConfig: () => ({ database: {}, project: { rootDir: '/tmp' } }),
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

import { handleSubagentStart, handleSubagentStop } from '../../src/hooks/subagent-hooks';

describe('subagent-hooks', () => {
  let stdoutSpy: jest.SpyInstance;
  let stderrSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadActiveRules.mockReturnValue({
      preferences: [], corrections: [], failures: [], devops: [], summary: '',
    });
    stdoutSpy = jest.spyOn(console, 'log').mockImplementation();
    stderrSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe('handleSubagentStart', () => {
    it('outputs JSON with additionalContext when rules exist', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [{ key: 'p1', value: { content: 'Use TypeScript' } }],
        corrections: [{ key: 'c1', value: { content: 'Never use var' } }],
        failures: [], devops: [], summary: '',
      });

      await handleSubagentStart({
        hook_event_name: 'SubagentStart',
        agent_id: 'agent-123',
        agent_type: 'general-purpose',
        session_id: 'sess-1',
      });

      expect(stdoutSpy).toHaveBeenCalledTimes(1);
      const output = JSON.parse(stdoutSpy.mock.calls[0][0]);
      expect(output.hookEventName).toBe('SubagentStart');
      expect(output.additionalContext).toContain('Use TypeScript');
      expect(output.additionalContext).toContain('Never use var');
      expect(output.additionalContext).toContain('Claude Recall');
    });

    it('notifies user via stderr', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [{ key: 'p1', value: 'x' }],
        corrections: [], failures: [], devops: [], summary: '',
      });

      await handleSubagentStart({
        agent_type: 'code-reviewer',
        agent_id: 'a1',
      });

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Recall: 1 rules loaded for sub-agent (code-reviewer)')
      );
    });

    it('outputs nothing when no rules exist', async () => {
      await handleSubagentStart({
        agent_type: 'general-purpose',
        agent_id: 'a1',
      });

      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('handles null input gracefully', async () => {
      await expect(handleSubagentStart(null)).resolves.not.toThrow();
      await expect(handleSubagentStart({})).resolves.not.toThrow();
    });
  });

  describe('handleSubagentStop', () => {
    it('records outcome event', async () => {
      await handleSubagentStop({
        hook_event_name: 'SubagentStop',
        agent_id: 'agent-123',
        agent_type: 'general-purpose',
        last_assistant_message: 'Task completed successfully',
      });

      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'subagent_result',
          actor: 'tool',
          tags: expect.arrayContaining(['agent', 'subagent', 'general-purpose']),
        })
      );
    });

    it('includes last_assistant_message in outcome', async () => {
      await handleSubagentStop({
        agent_type: 'code-reviewer',
        agent_id: 'a1',
        last_assistant_message: 'Found 3 issues in the code',
      });

      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          next_state_summary: expect.stringContaining('Found 3 issues'),
        })
      );
    });

    it('handles missing last_assistant_message', async () => {
      await handleSubagentStop({
        agent_type: 'general-purpose',
        agent_id: 'a1',
      });

      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          next_state_summary: 'No final message',
        })
      );
    });

    it('notifies user via stderr', async () => {
      await handleSubagentStop({
        agent_type: 'code-reviewer',
        agent_id: 'a1',
      });

      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('Recall: sub-agent (code-reviewer) outcome captured')
      );
    });

    it('handles null input gracefully', async () => {
      await expect(handleSubagentStop(null)).resolves.not.toThrow();
      await expect(handleSubagentStop({})).resolves.not.toThrow();
    });
  });
});
