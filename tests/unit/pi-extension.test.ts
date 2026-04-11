/**
 * Tests for the Pi extension entry point.
 * Mocks Pi's ExtensionAPI and verifies tools are registered correctly.
 */

const mockStore = jest.fn();
const mockDelete = jest.fn().mockReturnValue(true);
const mockSearch = jest.fn().mockReturnValue([]);
const mockFindRelevant = jest.fn().mockReturnValue([]);
const mockLoadActiveRules = jest.fn().mockReturnValue({
  preferences: [], corrections: [], failures: [], devops: [], summary: '',
});
const mockRecordRetrieval = jest.fn();
const mockSaveCheckpoint = jest.fn();
const mockHasCheckpoint = jest.fn().mockReturnValue(false);
const mockLoadCheckpoint = jest.fn().mockReturnValue(null);

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      store: mockStore,
      delete: mockDelete,
      search: mockSearch,
      findRelevant: mockFindRelevant,
      loadActiveRules: mockLoadActiveRules,
      saveCheckpoint: mockSaveCheckpoint,
      hasCheckpoint: mockHasCheckpoint,
      loadCheckpoint: mockLoadCheckpoint,
    }),
  },
}));

// Mock LLM classifier so checkpoint extraction is deterministic in tests
const mockExtractCheckpointWithLLM = jest.fn();
const mockExtractSessionLearningsWithLLM = jest.fn().mockResolvedValue(null);
const mockClassifyWithLLM = jest.fn().mockResolvedValue(null);
const mockClassifyBatchWithLLM = jest.fn().mockResolvedValue(null);
const mockExtractHindsightHint = jest.fn().mockResolvedValue(null);

jest.mock('../../src/hooks/llm-classifier', () => ({
  extractCheckpointWithLLM: (...args: any[]) => mockExtractCheckpointWithLLM(...args),
  extractSessionLearningsWithLLM: (...args: any[]) => mockExtractSessionLearningsWithLLM(...args),
  classifyWithLLM: (...args: any[]) => mockClassifyWithLLM(...args),
  classifyBatchWithLLM: (...args: any[]) => mockClassifyBatchWithLLM(...args),
  extractHindsightHint: (...args: any[]) => mockExtractHindsightHint(...args),
}));

const mockUpdateConfig = jest.fn();

jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => 'test-project',
      getDatabasePath: () => ':memory:',
      getConfig: () => ({ database: {}, project: { rootDir: '/tmp' } }),
      updateConfig: mockUpdateConfig,
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
      recordRetrieval: mockRecordRetrieval,
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

import piExtension from '../../src/pi/extension';

// Mock Pi's ExtensionAPI
function createMockPiApi() {
  const tools: Array<{ name: string; execute: Function }> = [];
  const handlers: Record<string, Function> = {};

  const api = {
    registerTool: jest.fn((tool: any) => tools.push(tool)),
    on: jest.fn((event: string, handler: Function) => { handlers[event] = handler; }),
    registerCommand: jest.fn(),
    sendMessage: jest.fn(),
    // Expose for testing
    _tools: tools,
    _handlers: handlers,
  };

  return api;
}

function mockCtx(cwd = '/home/user/project'): any {
  return { cwd, sessionManager: {}, isIdle: () => true };
}

describe('Pi Extension', () => {
  let api: ReturnType<typeof createMockPiApi>;

  beforeEach(() => {
    jest.clearAllMocks();
    api = createMockPiApi();
    piExtension(api as any);
  });

  describe('registration', () => {
    it('registers 6 tools', () => {
      expect(api.registerTool).toHaveBeenCalledTimes(6);
    });

    it('registers recall_load_rules', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_load_rules');
    });

    it('registers recall_store_memory', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_store_memory');
    });

    it('registers recall_save_checkpoint', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_save_checkpoint');
    });

    it('registers recall_load_checkpoint', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_load_checkpoint');
    });

    it('registers recall_search_memory', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_search_memory');
    });

    it('registers recall_delete_memory', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_delete_memory');
    });

    it('registers session_start event handler', () => {
      expect(api.on).toHaveBeenCalledWith('session_start', expect.any(Function));
    });
  });

  describe('recall_load_rules tool', () => {
    it('returns formatted rules', async () => {
      mockLoadActiveRules.mockReturnValueOnce({
        preferences: [{ key: 'p1', value: { content: 'Use TypeScript' } }],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      const tool = api._tools.find(t => t.name === 'recall_load_rules')!;
      const result = await tool.execute('id', {}, undefined, undefined, mockCtx());

      expect(result.content[0].text).toContain('Preferences');
      expect(result.content[0].text).toContain('Use TypeScript');
      expect(result.content[0].text).toContain('Before your FIRST action');
    });

    it('returns empty message when no rules', async () => {
      const tool = api._tools.find(t => t.name === 'recall_load_rules')!;
      const result = await tool.execute('id', {}, undefined, undefined, mockCtx());

      expect(result.content[0].text).toContain('No active rules found');
    });

    it('tracks retrievals', async () => {
      mockLoadActiveRules.mockReturnValueOnce({
        preferences: [{ key: 'p1', value: 'x' }],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      const tool = api._tools.find(t => t.name === 'recall_load_rules')!;
      await tool.execute('id', {}, undefined, undefined, mockCtx());

      expect(mockRecordRetrieval).toHaveBeenCalledWith('p1');
    });
  });

  describe('recall_store_memory tool', () => {
    it('stores a preference', async () => {
      const tool = api._tools.find(t => t.name === 'recall_store_memory')!;
      const result = await tool.execute('id', {
        content: 'Use tabs for indentation',
        metadata: { type: 'preference' },
      }, undefined, undefined, mockCtx());

      expect(mockStore).toHaveBeenCalledTimes(1);
      const call = mockStore.mock.calls[0][0];
      expect(call.type).toBe('preference');
      expect(call.value.content).toBe('Use tabs for indentation');

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it('defaults to preference type', async () => {
      const tool = api._tools.find(t => t.name === 'recall_store_memory')!;
      await tool.execute('id', { content: 'some rule' }, undefined, undefined, mockCtx());

      expect(mockStore.mock.calls[0][0].type).toBe('preference');
    });

    it('returns error for missing content', async () => {
      const tool = api._tools.find(t => t.name === 'recall_store_memory')!;
      const result = await tool.execute('id', {}, undefined, undefined, mockCtx());

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('content is required');
    });
  });

  describe('recall_search_memory tool', () => {
    it('searches and returns formatted results', async () => {
      mockFindRelevant.mockReturnValueOnce([
        { key: 'k1', type: 'preference', value: 'Use TS', score: 0.9 },
      ]);

      const tool = api._tools.find(t => t.name === 'recall_search_memory')!;
      const result = await tool.execute('id', { query: 'typescript' }, undefined, undefined, mockCtx());

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.results).toContain('Use TS');
    });

    it('returns error for missing query', async () => {
      const tool = api._tools.find(t => t.name === 'recall_search_memory')!;
      const result = await tool.execute('id', {}, undefined, undefined, mockCtx());

      expect(result.isError).toBe(true);
    });
  });

  describe('recall_delete_memory tool', () => {
    it('deletes a memory by id', async () => {
      const tool = api._tools.find(t => t.name === 'recall_delete_memory')!;
      const result = await tool.execute('id', { id: 'some_key' }, undefined, undefined, mockCtx());

      expect(mockDelete).toHaveBeenCalledWith('some_key');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it('returns error for missing id', async () => {
      const tool = api._tools.find(t => t.name === 'recall_delete_memory')!;
      const result = await tool.execute('id', {}, undefined, undefined, mockCtx());

      expect(result.isError).toBe(true);
    });
  });

  describe('session_start handler', () => {
    it('sets project context from cwd', () => {
      const handler = api._handlers['session_start'];
      handler({ type: 'session_start' }, mockCtx('/home/user/my-project'));

      expect(mockUpdateConfig).toHaveBeenCalled();
    });
  });

  describe('event handler registration', () => {
    it('registers before_agent_start handler', () => {
      expect(api.on).toHaveBeenCalledWith('before_agent_start', expect.any(Function));
    });

    it('registers tool_result handler', () => {
      expect(api.on).toHaveBeenCalledWith('tool_result', expect.any(Function));
    });

    it('registers input handler', () => {
      expect(api.on).toHaveBeenCalledWith('input', expect.any(Function));
    });

    it('registers session_shutdown handler', () => {
      expect(api.on).toHaveBeenCalledWith('session_shutdown', expect.any(Function));
    });

    it('registers session_before_compact handler', () => {
      expect(api.on).toHaveBeenCalledWith('session_before_compact', expect.any(Function));
    });
  });

  describe('before_agent_start handler', () => {
    it('injects rules into system prompt on first call', () => {
      mockLoadActiveRules.mockReturnValueOnce({
        preferences: [{ key: 'p1', value: { content: 'Use tabs' } }],
        corrections: [], failures: [], devops: [], summary: '',
      });

      // Trigger session_start first to set projectId
      api._handlers['session_start']({ type: 'session_start' }, mockCtx());

      const result = api._handlers['before_agent_start'](
        { type: 'before_agent_start', prompt: 'hi', systemPrompt: 'base prompt' },
        mockCtx(),
      );

      expect(result?.systemPrompt).toContain('Use tabs');
      expect(result?.systemPrompt).toContain('base prompt');
    });

    it('only injects once per session', () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [{ key: 'p1', value: 'x' }],
        corrections: [], failures: [], devops: [], summary: '',
      });

      api._handlers['session_start']({ type: 'session_start' }, mockCtx());

      // First call returns system prompt
      const r1 = api._handlers['before_agent_start'](
        { type: 'before_agent_start', prompt: 'hi', systemPrompt: 'base' },
        mockCtx(),
      );
      expect(r1?.systemPrompt).toBeDefined();

      // Second call returns nothing (already loaded)
      const r2 = api._handlers['before_agent_start'](
        { type: 'before_agent_start', prompt: 'hi', systemPrompt: 'base' },
        mockCtx(),
      );
      expect(r2).toBeUndefined();
    });
  });

  describe('input handler', () => {
    it('returns continue action', () => {
      const result = api._handlers['input'](
        { type: 'input', text: 'hello world', source: 'interactive' },
        mockCtx(),
      );

      expect(result).toEqual({ action: 'continue' });
    });
  });

  describe('tool_result handler', () => {
    it('calls processToolOutcome for non-recall tools', () => {
      api._handlers['tool_result'](
        {
          type: 'tool_result',
          toolCallId: 'tc1',
          toolName: 'bash',
          input: { command: 'npm test' },
          content: [{ type: 'text', text: 'Exit code 1' }],
          isError: true,
          details: undefined,
        },
        mockCtx(),
      );

      // Should have created an outcome event via processToolOutcome
      expect(mockCreateOutcomeEvent).toHaveBeenCalled();
    });
  });

  describe('session_shutdown auto-checkpoint (Pi has no --resume flag)', () => {
    /**
     * Helper: drive the Pi extension through a full session lifecycle:
     * session_start → input(s) → tool_result(s) → session_shutdown,
     * then flush microtasks so the fire-and-forget extractCheckpoint
     * promise resolves before assertions.
     */
    async function runPiSession(opts: {
      cwd?: string;
      userTexts?: string[];
      toolResults?: Array<{ name: string; output: string; isError?: boolean }>;
    }) {
      const ctx = mockCtx(opts.cwd ?? '/home/user/test-project');
      api._handlers['session_start']({ type: 'session_start' }, ctx);

      for (const text of opts.userTexts ?? []) {
        api._handlers['input']({ type: 'input', text, source: 'interactive' }, ctx);
      }

      let toolCallId = 0;
      for (const tr of opts.toolResults ?? []) {
        api._handlers['tool_result'](
          {
            type: 'tool_result',
            toolCallId: `tc${++toolCallId}`,
            toolName: tr.name,
            input: { command: 'fake' },
            content: [{ type: 'text', text: tr.output }],
            isError: tr.isError ?? false,
            details: undefined,
          },
          ctx,
        );
      }

      api._handlers['session_shutdown']({ type: 'session_shutdown' }, ctx);

      // Flush microtasks so all fire-and-forget promises (extractCheckpoint,
      // processSessionEnd, extractSessionLearnings) settle.
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    }

    it('saves a checkpoint when LLM extracts valid resumable work', async () => {
      mockExtractCheckpointWithLLM.mockResolvedValueOnce({
        completed: 'Added saveCheckpoint method to storage layer',
        remaining: 'Wire CLI command and add MCP/Pi tool wrappers',
        blockers: 'none',
      });

      await runPiSession({
        userTexts: [
          'Add a task-checkpoint feature to claude-recall',
          'Now wire it through MemoryService',
        ],
        toolResults: [
          { name: 'Read', output: 'storage.ts contents' },
          { name: 'Edit', output: 'Edit successful' },
        ],
      });

      expect(mockExtractCheckpointWithLLM).toHaveBeenCalledTimes(1);
      expect(mockSaveCheckpoint).toHaveBeenCalledTimes(1);

      const [pid, payload] = mockSaveCheckpoint.mock.calls[0];
      expect(pid).toBe('test-project');
      expect(payload.remaining).toBe('Wire CLI command and add MCP/Pi tool wrappers');
      expect(payload.completed).toBe('Added saveCheckpoint method to storage layer');
      expect(payload.notes).toContain('pi'); // runtime tag
      expect(payload.notes).toContain('auto-saved');
    });

    it('does NOT save when extraction has empty remaining (quality gate)', async () => {
      mockExtractCheckpointWithLLM.mockResolvedValueOnce({
        completed: 'fixed bug',
        remaining: '', // empty — nothing to resume
        blockers: 'none',
      });

      await runPiSession({
        userTexts: ['fix the [object Object] bug', 'looks good now'],
        toolResults: [
          { name: 'Edit', output: 'Edit successful' },
          { name: 'Bash', output: 'tests passed' },
        ],
      });

      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
    });

    it('does NOT save when LLM returns null (no API key in test env)', async () => {
      mockExtractCheckpointWithLLM.mockResolvedValueOnce(null);

      await runPiSession({
        userTexts: ['add a feature', 'continue', 'keep going'],
        toolResults: [
          { name: 'Edit', output: 'ok' },
          { name: 'Bash', output: 'ok' },
        ],
      });

      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
    });

    it('skips extraction entirely when too few entries collected (<3)', async () => {
      mockExtractCheckpointWithLLM.mockResolvedValueOnce({
        completed: 'x',
        remaining: 'this should not be saved because we never call the LLM',
        blockers: 'none',
      });

      await runPiSession({
        userTexts: ['hi'],
        toolResults: [{ name: 'Read', output: 'ok' }],
      });

      // 1 user + 1 tool = 2 entries, below the 3-entry minimum
      expect(mockExtractCheckpointWithLLM).not.toHaveBeenCalled();
      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
    });

    it('uses chronologically interleaved entries (not user-then-tool concat)', async () => {
      mockExtractCheckpointWithLLM.mockResolvedValueOnce({
        completed: '',
        remaining: 'finishing the wire-up of save_checkpoint into MCP tools',
        blockers: 'none',
      });

      await runPiSession({
        userTexts: ['first prompt', 'second prompt'],
        toolResults: [{ name: 'Edit', output: 'edit done' }],
      });

      expect(mockExtractCheckpointWithLLM).toHaveBeenCalledTimes(1);
      const summary = mockExtractCheckpointWithLLM.mock.calls[0][0];
      expect(typeof summary).toBe('string');
      // Both user texts AND the tool result should be in the summary
      expect(summary).toContain('first prompt');
      expect(summary).toContain('second prompt');
      expect(summary).toContain('edit done');
    });

    it('does not crash when saveCheckpoint throws (best-effort)', async () => {
      mockExtractCheckpointWithLLM.mockResolvedValueOnce({
        completed: 'x',
        remaining: 'finishing the implementation of save handler',
        blockers: 'none',
      });
      mockSaveCheckpoint.mockImplementationOnce(() => {
        throw new Error('DB locked');
      });

      // Should not throw despite saveCheckpoint blowing up
      await expect(
        runPiSession({
          userTexts: ['add feature', 'keep working'],
          toolResults: [{ name: 'Edit', output: 'ok' }],
        }),
      ).resolves.toBeUndefined();
    });
  });
});
