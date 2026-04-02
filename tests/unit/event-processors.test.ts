/**
 * Tests for shared event processors used by both CC hooks and Pi extension.
 */

const mockStore = jest.fn();
const mockSearch = jest.fn().mockReturnValue([]);
const mockFindRelevant = jest.fn().mockReturnValue([]);
const mockLoadActiveRules = jest.fn().mockReturnValue({
  preferences: [], corrections: [], failures: [], devops: [], summary: '',
});

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      store: mockStore,
      search: mockSearch,
      findRelevant: mockFindRelevant,
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

const mockCreateOutcomeEvent = jest.fn().mockReturnValue('event-id');
const mockCreateEpisode = jest.fn().mockReturnValue('episode-id');
const mockUpdateEpisode = jest.fn();
const mockPruneOldData = jest.fn();

jest.mock('../../src/services/outcome-storage', () => ({
  OutcomeStorage: {
    getInstance: () => ({
      createOutcomeEvent: mockCreateOutcomeEvent,
      createEpisode: mockCreateEpisode,
      updateEpisode: mockUpdateEpisode,
      pruneOldData: mockPruneOldData,
    }),
  },
}));

jest.mock('../../src/services/promotion-engine', () => ({
  PromotionEngine: {
    getInstance: () => ({
      runCycle: jest.fn().mockReturnValue({ promoted: 0, archived: 0 }),
    }),
  },
}));

import {
  processToolOutcome,
  processUserInput,
  processSessionEnd,
  processPreCompact,
  setLogFunction,
} from '../../src/shared/event-processors';

describe('event-processors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockReturnValue([]);
    setLogFunction(() => {}); // silent
  });

  describe('processToolOutcome', () => {
    it('records outcome event for any tool', () => {
      processToolOutcome('Read', { file_path: '/test.ts' }, 'file contents', false, 'sess1');

      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'tool_result', actor: 'tool' })
      );
    });

    it('stores failure for Bash with non-zero exit', () => {
      processToolOutcome('Bash', { command: 'npm test' }, 'Error\nExit code 1', false, 'sess1');

      expect(mockStore).toHaveBeenCalledTimes(1);
      expect(mockStore.mock.calls[0][0].type).toBe('failure');
    });

    it('stores failure for Edit with permission denied', () => {
      processToolOutcome('Edit', { file_path: '/etc/hosts' }, 'permission denied', false, 'sess1');

      expect(mockStore).toHaveBeenCalledTimes(1);
    });

    it('stores failure when isError is true', () => {
      processToolOutcome('Write', { file_path: '/test.ts' }, 'ENOENT', true, 'sess1');

      expect(mockStore).toHaveBeenCalledTimes(1);
    });

    it('does not store failure for successful tool', () => {
      processToolOutcome('Read', { file_path: '/test.ts' }, 'file contents here', false, 'sess1');

      expect(mockStore).not.toHaveBeenCalled();
    });

    it('skips claude-recall own tools', () => {
      processToolOutcome('recall_load_rules', {}, 'some output', true, 'sess1');

      expect(mockStore).not.toHaveBeenCalled();
      expect(mockCreateOutcomeEvent).not.toHaveBeenCalled();
    });

    it('skips MCP claude-recall tools', () => {
      processToolOutcome('mcp__claude-recall__store_memory', {}, 'error', true, 'sess1');

      expect(mockStore).not.toHaveBeenCalled();
      expect(mockCreateOutcomeEvent).not.toHaveBeenCalled();
    });

    it('does not store failure for long output with error keyword', () => {
      const longOutput = 'This normal response mentions error in passing. '.repeat(20);
      processToolOutcome('Grep', {}, longOutput, false, 'sess1');

      expect(mockStore).not.toHaveBeenCalled();
    });
  });

  describe('processUserInput', () => {
    it('returns null for short input', async () => {
      const result = await processUserInput('hi', 'sess1');
      expect(result).toBeNull();
    });

    it('returns null for code blocks', async () => {
      const result = await processUserInput('```typescript\nconst x = 1;\n```', 'sess1');
      expect(result).toBeNull();
    });

    it('detects reask signals', async () => {
      await processUserInput('that didnt work, the build is still broken and failing', 'sess1');

      expect(mockCreateOutcomeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'reask_signal', actor: 'user' })
      );
    });

    it('returns null for unclassifiable input', async () => {
      // classifyContent (regex fallback) won't match generic text
      const result = await processUserInput('What is the weather like today in the city?', 'sess1');
      expect(result).toBeNull();
    });
  });

  describe('processSessionEnd', () => {
    it('creates an episode', async () => {
      await processSessionEnd([], 'sess1', 'proj1');

      expect(mockCreateEpisode).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 'proj1', session_id: 'sess1' })
      );
    });

    it('updates episode after processing', async () => {
      await processSessionEnd([], 'sess1', 'proj1');

      expect(mockUpdateEpisode).toHaveBeenCalledWith('episode-id', expect.any(Object));
    });

    it('prunes old data', async () => {
      await processSessionEnd([], 'sess1', 'proj1');

      expect(mockPruneOldData).toHaveBeenCalled();
    });

    it('returns stored and promoted counts', async () => {
      const result = await processSessionEnd([], 'sess1', 'proj1');

      expect(result).toEqual({ stored: 0, promoted: 0 });
    });

    it('handles empty user texts gracefully', async () => {
      const result = await processSessionEnd([], 'sess1', 'proj1');
      expect(result.stored).toBe(0);
    });
  });

  describe('processPreCompact', () => {
    it('returns 0 for empty texts', async () => {
      const stored = await processPreCompact([], 'sess1');
      expect(stored).toBe(0);
    });

    it('returns 0 for texts that are too short', async () => {
      const stored = await processPreCompact(['hi', 'ok'], 'sess1');
      expect(stored).toBe(0);
    });
  });
});
