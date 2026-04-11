/**
 * Tests for auto-checkpoint extraction from session transcripts.
 *
 * Goal: when a session ends (Pi session_shutdown or CC SessionEnd hook), extract
 * a "where I left off" checkpoint from the most recent task in the session and
 * save it via MemoryService.saveCheckpoint, so the NEXT session can resume.
 *
 * Critical for Pi (which has no `--resume` flag, unlike Claude Code).
 *
 * Quality gate: skip the save if the LLM extraction has an empty `remaining`
 * field — without something left to do, there's nothing to resume from, and
 * saving would clobber a manually-saved checkpoint with garbage.
 */

const mockSaveCheckpoint = jest.fn();

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      saveCheckpoint: mockSaveCheckpoint,
      // Other methods stubbed for any incidental calls
      loadActiveRules: jest.fn().mockReturnValue({
        preferences: [], corrections: [], failures: [], devops: [], summary: '',
      }),
      store: jest.fn(),
      search: jest.fn().mockReturnValue([]),
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

jest.mock('../../src/services/logging', () => ({
  LoggingService: {
    getInstance: () => ({
      info: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }),
  },
}));

jest.mock('../../src/services/outcome-storage', () => ({
  OutcomeStorage: {
    getInstance: () => ({
      createOutcomeEvent: jest.fn(),
    }),
  },
}));

const mockExtractCheckpointWithLLM = jest.fn();
jest.mock('../../src/hooks/llm-classifier', () => ({
  extractCheckpointWithLLM: (...args: any[]) => mockExtractCheckpointWithLLM(...args),
  extractSessionLearningsWithLLM: jest.fn().mockResolvedValue([]),
}));

import {
  extractCheckpoint,
  ConversationEntry,
  setLogFunction,
} from '../../src/shared/event-processors';

function makeRecentTaskEntries(): ConversationEntry[] {
  // Mimics a transcript where the user was mid-feature when they exited
  return [
    { role: 'user', text: 'Add a task-checkpoint feature to claude-recall' },
    { role: 'assistant', text: 'Reading existing storage layer', toolName: 'Read' },
    { role: 'tool_result', text: 'storage.ts contents', toolName: 'Read', isError: false },
    { role: 'assistant', text: 'Adding saveCheckpoint method', toolName: 'Edit' },
    { role: 'tool_result', text: 'Edit successful', toolName: 'Edit', isError: false },
    { role: 'user', text: 'Now wire it through MemoryService' },
    { role: 'assistant', text: 'Adding wrapper method', toolName: 'Edit' },
    { role: 'tool_result', text: 'Edit successful', toolName: 'Edit', isError: false },
  ];
}

describe('extractCheckpoint (auto-save on session end)', () => {
  let logMessages: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockExtractCheckpointWithLLM.mockResolvedValue(null);
    logMessages = [];
    setLogFunction((_source, msg) => logMessages.push(msg));
  });

  it('returns false and skips save when entries are empty', async () => {
    const result = await extractCheckpoint([], 'test-project', 'pi');
    expect(result).toBe(false);
    expect(mockExtractCheckpointWithLLM).not.toHaveBeenCalled();
    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
  });

  it('returns false and skips save when entries are too few (<3)', async () => {
    const result = await extractCheckpoint(
      [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }],
      'test-project',
      'pi',
    );
    expect(result).toBe(false);
    expect(mockExtractCheckpointWithLLM).not.toHaveBeenCalled();
    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
  });

  it('calls extractCheckpointWithLLM with a recent-task summary string', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce(null);

    await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi');

    expect(mockExtractCheckpointWithLLM).toHaveBeenCalledTimes(1);
    const summaryArg = mockExtractCheckpointWithLLM.mock.calls[0][0];
    expect(typeof summaryArg).toBe('string');
    expect(summaryArg.length).toBeGreaterThan(0);
    // Recent-task summary should include the last user prompt
    expect(summaryArg).toContain('Now wire it through MemoryService');
  });

  it('returns false and skips save when LLM returns null (no API key, parse error, etc.)', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce(null);

    const result = await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi');

    expect(result).toBe(false);
    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
  });

  it('quality gate: returns false when LLM returns object with empty remaining', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce({
      completed: 'Added saveCheckpoint method',
      remaining: '', // empty — nothing to resume
      blockers: 'none',
    });

    const result = await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi');

    expect(result).toBe(false);
    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
  });

  it('quality gate: returns false when LLM returns object with whitespace-only remaining', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce({
      completed: 'x',
      remaining: '   ',
      blockers: 'none',
    });

    const result = await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi');

    expect(result).toBe(false);
    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
  });

  it('quality gate: returns false when remaining is too short (<10 chars)', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce({
      completed: 'Added X',
      remaining: 'tbd',
      blockers: 'none',
    });

    const result = await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi');

    expect(result).toBe(false);
    expect(mockSaveCheckpoint).not.toHaveBeenCalled();
  });

  it('saves checkpoint when LLM returns valid extraction (Pi runtime)', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce({
      completed: 'Added saveCheckpoint method, wired through MemoryService',
      remaining: 'Add CLI command, MCP tool, Pi extension wrapper, write tests',
      blockers: 'none',
    });

    const result = await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi');

    expect(result).toBe(true);
    expect(mockSaveCheckpoint).toHaveBeenCalledTimes(1);

    const [pid, payload] = mockSaveCheckpoint.mock.calls[0];
    expect(pid).toBe('test-project');
    expect(payload.completed).toBe('Added saveCheckpoint method, wired through MemoryService');
    expect(payload.remaining).toBe('Add CLI command, MCP tool, Pi extension wrapper, write tests');
    expect(payload.blockers).toBe('none');
    // Notes must tag this as auto-saved with the runtime
    expect(payload.notes).toBeDefined();
    expect(payload.notes).toContain('auto-saved');
    expect(payload.notes).toContain('pi');
  });

  it('saves checkpoint with cc tag when runtime is "cc"', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce({
      completed: 'fixed bug X',
      remaining: 'still need to add tests for the new helper',
      blockers: 'none',
    });

    const result = await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'cc');

    expect(result).toBe(true);
    const payload = mockSaveCheckpoint.mock.calls[0][1];
    expect(payload.notes).toContain('cc');
  });

  it('handles missing fields gracefully (LLM returns partial object)', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce({
      // missing completed and blockers entirely
      remaining: 'finish wiring up the new feature in the CLI',
    });

    const result = await extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi');

    // remaining is valid → should save, with empty defaults for missing fields
    expect(result).toBe(true);
    const payload = mockSaveCheckpoint.mock.calls[0][1];
    expect(payload.remaining).toBe('finish wiring up the new feature in the CLI');
    expect(payload.completed).toBe('');
    expect(payload.blockers).toBe('');
  });

  it('does not throw when MemoryService.saveCheckpoint throws', async () => {
    mockExtractCheckpointWithLLM.mockResolvedValueOnce({
      completed: 'x',
      remaining: 'finish writing tests',
      blockers: 'none',
    });
    mockSaveCheckpoint.mockImplementationOnce(() => {
      throw new Error('DB locked');
    });

    // Should not throw — checkpoint extraction is best-effort
    await expect(
      extractCheckpoint(makeRecentTaskEntries(), 'test-project', 'pi'),
    ).resolves.toBe(false);
  });
});
