/**
 * Tests for the Pi extension entry point.
 * Mocks Pi's ExtensionAPI and verifies tools are registered correctly.
 */

const mockStore = jest.fn().mockReturnValue({ stored: true });
const mockDelete = jest.fn().mockReturnValue(true);
const mockSearch = jest.fn().mockReturnValue([]);
const mockFindRelevant = jest.fn().mockReturnValue([]);
const mockLoadActiveRules = jest.fn().mockReturnValue({
  preferences: [], corrections: [], failures: [], devops: [], summary: '',
});
const mockRecordRetrieval = jest.fn();
const mockIncrementCiteCount = jest.fn();
const mockGetAllRulesForCitationMatching = jest.fn().mockReturnValue([]);

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      store: mockStore,
      delete: mockDelete,
      search: mockSearch,
      findRelevant: mockFindRelevant,
      loadActiveRules: mockLoadActiveRules,
      incrementCiteCount: mockIncrementCiteCount,
      getAllRulesForCitationMatching: mockGetAllRulesForCitationMatching,
    }),
  },
}));

// In-session review: the real logic is tested in review-command.test.ts; here
// only the wiring (which input reaches it, and what Pi does with the answer).
const mockHandleReviewInput = jest.fn((text: string) => (/^recall /i.test(text) ? 'REVIEW SHOWN' : null));
jest.mock('../../src/shared/review-command', () => ({
  handleReviewInput: (...a: any[]) => (mockHandleReviewInput as any)(...a),
}));

// Mock LLM classifier so session-end extraction is deterministic in tests
const mockExtractSessionLearningsWithLLM = jest.fn().mockResolvedValue(null);
const mockClassifyWithLLM = jest.fn().mockResolvedValue(null);
const mockClassifyBatchWithLLM = jest.fn().mockResolvedValue(null);

jest.mock('../../src/hooks/llm-classifier', () => ({
  extractSessionLearningsWithLLM: (...args: any[]) => mockExtractSessionLearningsWithLLM(...args),
  classifyWithLLM: (...args: any[]) => mockClassifyWithLLM(...args),
  classifyBatchWithLLM: (...args: any[]) => mockClassifyBatchWithLLM(...args),
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

import piExtension from '../../src/pi/extension';

// Mock Pi's ExtensionAPI
function createMockPiApi() {
  const tools: Array<{ name: string; execute: (...args: any[]) => any }> = [];
  const handlers: Record<string, (...args: any[]) => any> = {};

  const api = {
    registerTool: jest.fn((tool: any) => tools.push(tool)),
    on: jest.fn((event: string, handler: (...args: any[]) => any) => { handlers[event] = handler; }),
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

    it('no longer registers the retired checkpoint tools', () => {
      const names = api._tools.map(t => t.name);
      expect(names).not.toContain('recall_save_checkpoint');
      expect(names).not.toContain('recall_load_checkpoint');
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

  describe('announcing the Pi host', () => {
    const saved = { ...process.env };

    afterEach(() => { process.env = { ...saved }; });

    it('tells the LLM backends in-process, and leaves the environment alone', () => {
      delete process.env.CLAUDE_RECALL_RUNTIME;
      delete process.env.CLAUDE_RECALL_NESTED;
      process.env.CLAUDE_RECALL_PI_LLM = '1';
      jest.resetModules();
      const backend = require('../../src/hooks/pi-classifier');
      expect(backend.piBackendEnabled()).toBe(false);

      require('../../src/pi/extension').default(createMockPiApi());

      expect(backend.piBackendEnabled()).toBe(true);
      // A child of this process — `claude` from Pi's bash tool, say — inherits
      // the environment, and must not inherit a claim to be Pi with it.
      expect(process.env.CLAUDE_RECALL_RUNTIME).toBeUndefined();
    });
  });

  describe('nested session', () => {
    it('does nothing at all when spawned by our own LLM backend', () => {
      const prev = process.env.CLAUDE_RECALL_NESTED;
      process.env.CLAUDE_RECALL_NESTED = '1';
      jest.resetModules();
      const nestedApi: any = { on: jest.fn(), registerTool: jest.fn(), registerCommand: jest.fn() };

      try {
        require('../../src/pi/extension').default(nestedApi);
        expect(nestedApi.on).not.toHaveBeenCalled();
        expect(nestedApi.registerTool).not.toHaveBeenCalled();
      } finally {
        if (prev === undefined) delete process.env.CLAUDE_RECALL_NESTED;
        else process.env.CLAUDE_RECALL_NESTED = prev;
      }
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

    it('handles a review command the user typed: shown to them, never sent to the model', () => {
      const notify = jest.fn();
      const result = api._handlers['input'](
        { type: 'input', text: 'recall review', source: 'interactive' },
        { ...mockCtx(), hasUI: true, ui: { notify } },
      );
      expect(result).toEqual({ action: 'handled' });
      expect(notify).toHaveBeenCalledWith('REVIEW SHOWN', 'info');
    });

    it('ignores review commands that did not come from the user typing', () => {
      for (const source of ['extension', 'rpc'] as const) {
        const result = api._handlers['input'](
          { type: 'input', text: 'recall approve all', source },
          mockCtx(),
        );
        expect(result).toEqual({ action: 'continue' });
      }
      expect(mockHandleReviewInput).not.toHaveBeenCalledWith('recall approve all', expect.anything(), expect.anything());
    });
  });

  describe('message_end handler (citation credit)', () => {
    const assistantSaying = (text: string) => ({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text }] },
    });

    /** A turn that injected one rule, which is what makes it citable. */
    function turnInjecting(content: string, key = 'r-verify'): void {
      mockLoadActiveRules.mockReturnValueOnce({
        preferences: [{ key, value: { content } }],
        corrections: [], failures: [], devops: [], summary: '',
      });
      api._handlers['session_start']({ type: 'session_start' }, mockCtx());
      api._handlers['before_agent_start'](
        { type: 'before_agent_start', prompt: content, systemPrompt: 'base prompt' },
        mockCtx(),
      );
    }

    beforeEach(() => {
      turnInjecting('rebuild the bundle before running the suite');
    });

    it('credits the rule the assistant says it applied', () => {
      api._handlers['message_end'](
        assistantSaying('Done (applied from memory: rebuild the bundle before running the suite).'),
        mockCtx(),
      );

      expect(mockIncrementCiteCount).toHaveBeenCalledTimes(1);
      expect(mockIncrementCiteCount).toHaveBeenCalledWith('r-verify');
    });

    it('credits nobody for a rule it never injected — AGENTS.md and skills are not ours to claim', () => {
      api._handlers['message_end'](
        assistantSaying('Checked it (applied from memory: deploy the staging cluster at midnight).'),
        mockCtx(),
      );

      expect(mockIncrementCiteCount).not.toHaveBeenCalled();
    });

    it('does not carry a turn\'s candidates into the next turn', () => {
      // The second turn has no prompt, so the JIT branch never runs. Without a
      // reset the previous turn's rules would still be standing there, and the
      // citation below would credit a rule this turn never injected.
      api._handlers['before_agent_start'](
        { type: 'before_agent_start', prompt: '', systemPrompt: 'base prompt' },
        mockCtx(),
      );

      api._handlers['message_end'](
        assistantSaying('Done (applied from memory: rebuild the bundle before running the suite).'),
        mockCtx(),
      );

      expect(mockIncrementCiteCount).not.toHaveBeenCalled();
    });

    it('ignores the directive text itself, so the placeholder earns no credit', () => {
      api._handlers['message_end'](
        assistantSaying('cite like this: (applied from memory: <short summary>)'),
        mockCtx(),
      );

      expect(mockIncrementCiteCount).not.toHaveBeenCalled();
    });

    it('ignores user messages — only the assistant can apply a rule', () => {
      api._handlers['message_end'](
        {
          type: 'message_end',
          message: { role: 'user', content: [{ type: 'text', text: '(applied from memory: self-verify before done)' }] },
        },
        mockCtx(),
      );

      expect(mockIncrementCiteCount).not.toHaveBeenCalled();
    });

    it('does not touch the database when the message carries no citation', () => {
      api._handlers['message_end'](assistantSaying('Done, no marks here.'), mockCtx());

      expect(mockIncrementCiteCount).not.toHaveBeenCalled();
    });

    it('still records the citation when no rule was injected to match it', () => {
      // A fresh session with nothing injected: nobody is credited, but the
      // citation must not vanish — that is how we measure precision.
      mockIncrementCiteCount.mockClear();

      api._handlers['message_end'](
        assistantSaying('Done (applied from memory: some rule we never supplied).'),
        mockCtx(),
      );

      expect(mockIncrementCiteCount).not.toHaveBeenCalled();
    });

    it('survives a malformed message rather than breaking the turn', () => {
      expect(() =>
        api._handlers['message_end']({ type: 'message_end' } as any, mockCtx()),
      ).not.toThrow();
    });
  });

  describe('tool_result handler', () => {
    const failingTool = {
      type: 'tool_result',
      toolCallId: 'tc1',
      toolName: 'bash',
      input: { command: 'npm test' },
      content: [{ type: 'text', text: 'Exit code 1' }],
      isError: true,
      details: undefined,
    };

    const prevTracking = process.env.CLAUDE_RECALL_OUTCOME_TRACKING;
    afterEach(() => {
      if (prevTracking === undefined) delete process.env.CLAUDE_RECALL_OUTCOME_TRACKING;
      else process.env.CLAUDE_RECALL_OUTCOME_TRACKING = prevTracking;
    });

    it('captures the failure but records no raw outcome event — Pi has no consumer for one', () => {
      api._handlers['tool_result'](failingTool, mockCtx());

      // The failure memory is the part Pi reads back (it is injected as a rule)
      expect(mockStore).toHaveBeenCalled();
      // The raw event is only written where the distillation step runs
      expect(mockCreateOutcomeEvent).not.toHaveBeenCalled();
    });

    it('records the raw outcome event when tracking is forced on', () => {
      process.env.CLAUDE_RECALL_OUTCOME_TRACKING = 'on';

      api._handlers['tool_result'](failingTool, mockCtx());

      expect(mockCreateOutcomeEvent).toHaveBeenCalled();
    });
  });

  describe('session_shutdown waits for its own work', () => {
    const flush = async () => {
      for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
    };

    function startSession() {
      const ctx = mockCtx('/home/user/test-project');
      api._handlers['session_start']({ type: 'session_start' }, ctx);
      api._handlers['input']({ type: 'input', text: 'please always run the linter before committing', source: 'interactive' }, ctx);
      mockUpdateEpisode.mockClear();
      return ctx;
    }

    it('has finished by the time Pi is told the handler is done', async () => {
      // Pi awaits this handler and then calls process.exit. Work the handler
      // merely started is cut off there, so "done" must mean done.
      let closeBatch: (results: null) => void = () => {};
      mockClassifyBatchWithLLM.mockImplementationOnce(() => new Promise(resolve => { closeBatch = resolve; }));
      const ctx = startSession();

      let handlerDone = false;
      const handler = Promise.resolve(
        api._handlers['session_shutdown']({ type: 'session_shutdown', reason: 'quit' }, ctx),
      ).then(() => { handlerDone = true; });
      await flush();

      // The session's classification is still out: the handler must be too.
      expect(handlerDone).toBe(false);
      expect(mockPruneOldData).not.toHaveBeenCalled();

      closeBatch(null);
      await handler;

      // Pruning is the last step of the session's end-of-session work.
      expect(mockPruneOldData).toHaveBeenCalled();
    });

    it('waits on a Pi that does not say why the session is ending', async () => {
      let closeBatch: (results: null) => void = () => {};
      mockClassifyBatchWithLLM.mockImplementationOnce(() => new Promise(resolve => { closeBatch = resolve; }));
      const ctx = startSession();

      let handlerDone = false;
      const handler = Promise.resolve(
        api._handlers['session_shutdown']({ type: 'session_shutdown' }, ctx),
      ).then(() => { handlerDone = true; });
      await flush();
      expect(handlerDone).toBe(false);

      closeBatch(null);
      await handler;
    });

    it('does not hold up a session that is only being replaced', async () => {
      // On /new, /resume or a fork the process lives on; the work finishes
      // behind the new session instead of in front of it. Fake timers, so that
      // "returns" cannot mean "returns once the budget has run out".
      jest.useFakeTimers();
      try {
        mockClassifyBatchWithLLM.mockImplementationOnce(() => new Promise(() => {}));
        const ctx = startSession();

        let handlerDone = false;
        void Promise.resolve(
          api._handlers['session_shutdown']({ type: 'session_shutdown', reason: 'new' }, ctx),
        ).then(() => { handlerDone = true; });
        await jest.advanceTimersByTimeAsync(0);

        expect(handlerDone).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('gives up waiting at its budget rather than keeping the user from leaving', async () => {
      jest.useFakeTimers();
      try {
        mockClassifyBatchWithLLM.mockImplementationOnce(() => new Promise(() => {}));
        const ctx = startSession();

        let handlerDone = false;
        void Promise.resolve(
          api._handlers['session_shutdown']({ type: 'session_shutdown', reason: 'quit' }, ctx),
        ).then(() => { handlerDone = true; });

        await jest.advanceTimersByTimeAsync(14000);
        expect(handlerDone).toBe(false);
        await jest.advanceTimersByTimeAsync(2000);
        expect(handlerDone).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
