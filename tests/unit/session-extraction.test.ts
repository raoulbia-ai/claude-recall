/**
 * Tests for session extraction — learning from long silent coding sessions.
 */

const mockStore = jest.fn();
const mockSearch = jest.fn().mockReturnValue([]);
const mockLoadActiveRules = jest.fn().mockReturnValue({
  preferences: [], corrections: [], failures: [], devops: [], summary: '',
});

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      store: mockStore,
      search: mockSearch,
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

// Mock LLM classifier — we control what it returns
const mockExtractWithLLM = jest.fn();
jest.mock('../../src/hooks/llm-classifier', () => ({
  extractSessionLearningsWithLLM: (...args: any[]) => mockExtractWithLLM(...args),
}));

import {
  extractSessionLearnings,
  ConversationEntry,
  buildSummary,
  setLogFunction,
} from '../../src/shared/event-processors';

function makeEntries(count: number): ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      entries.push({ role: 'user', text: `User message ${i}: do the thing` });
    } else if (i % 3 === 1) {
      entries.push({ role: 'assistant', text: `Running tool for step ${i}`, toolName: 'Bash' });
    } else {
      entries.push({ role: 'tool_result', text: `Result of step ${i}: success`, toolName: 'Bash', isError: false });
    }
  }
  return entries;
}

describe('session-extraction', () => {
  let logMessages: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReturnValue([]);
    mockExtractWithLLM.mockResolvedValue([]);
    logMessages = [];
    setLogFunction((_source, msg) => logMessages.push(msg));
  });

  describe('extractSessionLearnings', () => {
    it('skips short sessions (< 10 entries)', async () => {
      const result = await extractSessionLearnings(makeEntries(5), 'sess1', 'proj1');
      expect(result).toBe(0);
      expect(mockExtractWithLLM).not.toHaveBeenCalled();
    });

    it('calls LLM with conversation summary', async () => {
      mockExtractWithLLM.mockResolvedValueOnce([]);

      await extractSessionLearnings(makeEntries(15), 'sess1', 'proj1');

      expect(mockExtractWithLLM).toHaveBeenCalledTimes(1);
      const [summary, existingMems] = mockExtractWithLLM.mock.calls[0];
      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
      expect(Array.isArray(existingMems)).toBe(true);
    });

    it('stores learnings returned by LLM', async () => {
      mockExtractWithLLM.mockResolvedValueOnce([
        { type: 'project-knowledge', content: 'This project uses pnpm', confidence: 0.9 },
        { type: 'devops', content: 'Run tests from project root', confidence: 0.8 },
        { type: 'preference', content: 'Use ESM imports not CJS', confidence: 0.85 },
      ]);

      const result = await extractSessionLearnings(makeEntries(15), 'sess1', 'proj1');

      expect(result).toBe(3);
      expect(mockStore).toHaveBeenCalledTimes(3);
    });

    it('respects maxStore cap', async () => {
      mockExtractWithLLM.mockResolvedValueOnce([
        { type: 'project-knowledge', content: 'Learning 1', confidence: 0.9 },
        { type: 'project-knowledge', content: 'Learning 2', confidence: 0.9 },
        { type: 'project-knowledge', content: 'Learning 3', confidence: 0.9 },
        { type: 'project-knowledge', content: 'Learning 4', confidence: 0.9 },
        { type: 'project-knowledge', content: 'Learning 5', confidence: 0.9 },
        { type: 'project-knowledge', content: 'Learning 6', confidence: 0.9 },
      ]);

      const result = await extractSessionLearnings(makeEntries(15), 'sess1', 'proj1', 3);

      expect(result).toBe(3);
      expect(mockStore).toHaveBeenCalledTimes(3);
    });

    it('dedup skips overlapping memories', async () => {
      mockExtractWithLLM.mockResolvedValueOnce([
        { type: 'project-knowledge', content: 'This project uses pnpm not npm', confidence: 0.9 },
      ]);
      // searchExisting returns a near-identical memory (Jaccard >= 0.7)
      mockSearch.mockReturnValueOnce([
        { value: 'This project uses pnpm not npm', score: 0.9 },
      ]);

      const result = await extractSessionLearnings(makeEntries(15), 'sess1', 'proj1');

      expect(result).toBe(0);
      expect(mockStore).not.toHaveBeenCalled();
    });

    it('logs message when no API key available', async () => {
      mockExtractWithLLM.mockResolvedValueOnce(null);

      await extractSessionLearnings(makeEntries(15), 'sess1', 'proj1');

      expect(logMessages.some(m => m.includes('ANTHROPIC_API_KEY'))).toBe(true);
    });

    it('stores with correct type from LLM response', async () => {
      mockExtractWithLLM.mockResolvedValueOnce([
        { type: 'devops', content: 'Deploy with docker compose up', confidence: 0.85 },
      ]);

      await extractSessionLearnings(makeEntries(15), 'sess1', 'proj1');

      const storeCall = mockStore.mock.calls[0][0];
      expect(storeCall.type).toBe('devops');
    });

    it('returns 0 when LLM returns empty array', async () => {
      mockExtractWithLLM.mockResolvedValueOnce([]);

      const result = await extractSessionLearnings(makeEntries(15), 'sess1', 'proj1');
      expect(result).toBe(0);
    });
  });

  describe('buildSummary', () => {
    it('formats entries with role labels', () => {
      const entries: ConversationEntry[] = [
        { role: 'user', text: 'Fix the bug' },
        { role: 'assistant', text: 'Running npm test', toolName: 'Bash' },
        { role: 'tool_result', text: 'All tests passed', toolName: 'Bash', isError: false },
      ];

      const summary = buildSummary(entries);
      expect(summary).toContain('[user]');
      expect(summary).toContain('[assistant');
      expect(summary).toContain('[Bash]');
    });

    it('marks errors in tool results', () => {
      const entries: ConversationEntry[] = [
        { role: 'tool_result', text: 'Exit code 1', toolName: 'Bash', isError: true },
      ];

      const summary = buildSummary(entries);
      expect(summary).toContain('[ERROR]');
    });

    it('truncates to SUMMARY_MAX_CHARS', () => {
      const entries = makeEntries(200);
      const summary = buildSummary(entries);
      expect(summary.length).toBeLessThanOrEqual(4500); // some margin for last entry
    });

    it('returns empty string for empty entries', () => {
      expect(buildSummary([])).toBe('');
    });
  });
});
