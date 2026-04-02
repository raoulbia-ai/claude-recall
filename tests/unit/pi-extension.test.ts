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

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      store: mockStore,
      delete: mockDelete,
      search: mockSearch,
      findRelevant: mockFindRelevant,
      loadActiveRules: mockLoadActiveRules,
    }),
  },
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
    it('registers 4 tools', () => {
      expect(api.registerTool).toHaveBeenCalledTimes(4);
    });

    it('registers recall_load_rules', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_load_rules');
    });

    it('registers recall_store_memory', () => {
      const names = api._tools.map(t => t.name);
      expect(names).toContain('recall_store_memory');
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
});
