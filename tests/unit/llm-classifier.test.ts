/**
 * Unit tests for src/hooks/llm-classifier.ts
 *
 * The module lazy-requires '@anthropic-ai/sdk' inside getClient() and caches
 * the client module-globally, so every test loads a FRESH copy of the module
 * via jest.resetModules() + jest.doMock() + require(). ANTHROPIC_API_KEY is
 * set/deleted per test and restored afterwards. No real network calls are
 * ever made — the SDK is always mocked.
 */

type Classifier = typeof import('../../src/hooks/llm-classifier');

describe('llm-classifier', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;
  const originalTimeout = process.env.CLAUDE_RECALL_LLM_TIMEOUT_MS;

  let mockCreate: jest.Mock;
  let constructorSpy: jest.Mock;

  /**
   * Load a fresh copy of the classifier module with a mocked SDK.
   * Env vars must be arranged BEFORE calling this (getClient reads them lazily,
   * but resetModules keeps things deterministic either way).
   */
  function loadClassifier(): Classifier {
    jest.resetModules();
    mockCreate = jest.fn();
    constructorSpy = jest.fn();
    jest.doMock('@anthropic-ai/sdk', () => {
      return function MockAnthropic(this: any, options: any) {
        constructorSpy(options);
        this.messages = { create: mockCreate };
      };
    });
    return require('../../src/hooks/llm-classifier') as Classifier;
  }

  function textResponse(text: string) {
    return { content: [{ type: 'text', text }] };
  }

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_RECALL_LLM_TIMEOUT_MS;
  });

  afterAll(() => {
    if (originalApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    }
    if (originalTimeout === undefined) {
      delete process.env.CLAUDE_RECALL_LLM_TIMEOUT_MS;
    } else {
      process.env.CLAUDE_RECALL_LLM_TIMEOUT_MS = originalTimeout;
    }
  });

  describe('classifyWithLLM', () => {
    it('returns null when ANTHROPIC_API_KEY is unset and never touches the SDK', async () => {
      const classifier = loadClassifier();

      const result = await classifier.classifyWithLLM('always use tabs');

      expect(result).toBeNull();
      expect(constructorSpy).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('constructs the SDK client with timeout 5000 and maxRetries 0 by default', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"preference","confidence":0.9,"extract":"Use tabs"}')
      );

      await classifier.classifyWithLLM('we use tabs');

      expect(constructorSpy).toHaveBeenCalledTimes(1);
      expect(constructorSpy).toHaveBeenCalledWith({ timeout: 5000, maxRetries: 0 });
    });

    it('honors CLAUDE_RECALL_LLM_TIMEOUT_MS override', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.CLAUDE_RECALL_LLM_TIMEOUT_MS = '12345';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"preference","confidence":0.9,"extract":"Use tabs"}')
      );

      await classifier.classifyWithLLM('we use tabs');

      expect(constructorSpy).toHaveBeenCalledWith({ timeout: 12345, maxRetries: 0 });
    });

    it('falls back to 5000 when CLAUDE_RECALL_LLM_TIMEOUT_MS is not a positive number', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      process.env.CLAUDE_RECALL_LLM_TIMEOUT_MS = '-50';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"preference","confidence":0.9,"extract":"Use tabs"}')
      );

      await classifier.classifyWithLLM('we use tabs');

      expect(constructorSpy).toHaveBeenCalledWith({ timeout: 5000, maxRetries: 0 });
    });

    it('caches the client instance across calls (constructor invoked once)', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"preference","confidence":0.9,"extract":"Use tabs"}')
      );

      await classifier.classifyWithLLM('first call');
      await classifier.classifyWithLLM('second call');

      expect(constructorSpy).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('parses a clean JSON text response', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"correction","confidence":0.85,"extract":"Use pnpm, not npm"}')
      );

      const result = await classifier.classifyWithLLM('no, use pnpm not npm');

      expect(result).toEqual({
        type: 'correction',
        confidence: 0.85,
        extract: 'Use pnpm, not npm',
      });
    });

    it('strips markdown ```json fences before parsing', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('```json\n{"type":"devops","confidence":0.7,"extract":"Deploy via CI only"}\n```')
      );

      const result = await classifier.classifyWithLLM('deploy via CI only');

      expect(result).toEqual({
        type: 'devops',
        confidence: 0.7,
        extract: 'Deploy via CI only',
      });
    });

    it('returns null when the model classifies as "none"', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"none","confidence":0.0,"extract":"nothing"}')
      );

      expect(await classifier.classifyWithLLM('hello there')).toBeNull();
    });

    it('returns null on malformed JSON', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(textResponse('this is not json {'));

      expect(await classifier.classifyWithLLM('some text')).toBeNull();
    });

    it('returns null when required fields are missing', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"preference","confidence":0.9}')
      );

      expect(await classifier.classifyWithLLM('missing extract')).toBeNull();
    });

    it('returns null when confidence is not a number', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"preference","confidence":"high","extract":"Use tabs"}')
      );

      expect(await classifier.classifyWithLLM('bad confidence')).toBeNull();
    });

    it('returns null when the response content is not text', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue({ content: [{ type: 'tool_use', id: 'x' }] });

      expect(await classifier.classifyWithLLM('non-text response')).toBeNull();
    });

    it('returns null when the SDK throws', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockRejectedValue(new Error('network down'));

      expect(await classifier.classifyWithLLM('anything')).toBeNull();
    });
  });

  describe('classifyBatchWithLLM', () => {
    it('returns [] for an empty input without needing an API key', async () => {
      const classifier = loadClassifier();

      const result = await classifier.classifyBatchWithLLM([]);

      expect(result).toEqual([]);
      expect(constructorSpy).not.toHaveBeenCalled();
    });

    it('returns null when ANTHROPIC_API_KEY is unset', async () => {
      const classifier = loadClassifier();

      expect(await classifier.classifyBatchWithLLM(['a', 'b'])).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('sends the texts as a JSON array in the user message (---ITEM--- regression)', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      // Content deliberately contains the old delimiter — JSON boundaries must survive it
      const texts = ['use tabs ---ITEM--- everywhere', 'build failed with exit 1'];
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify([
          { type: 'preference', confidence: 0.9, extract: 'Use tabs' },
          { type: 'failure', confidence: 0.8, extract: 'Build failed with exit 1' },
        ]))
      );

      const result = await classifier.classifyBatchWithLLM(texts);

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArg = mockCreate.mock.calls[0][0];
      const userMessage = callArg.messages[0].content;
      expect(typeof userMessage).toBe('string');
      expect(JSON.parse(userMessage)).toEqual(texts);

      expect(result).toEqual([
        { type: 'preference', confidence: 0.9, extract: 'Use tabs' },
        { type: 'failure', confidence: 0.8, extract: 'Build failed with exit 1' },
      ]);
    });

    it('maps "none" and invalid items to null while keeping valid ones', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify([
          { type: 'none', confidence: 0.0, extract: 'nothing' },
          { type: 'preference', confidence: 0.9, extract: 'Use tabs' },
          { type: 'devops', confidence: 'oops', extract: 'bad confidence' },
        ]))
      );

      const result = await classifier.classifyBatchWithLLM(['a', 'b', 'c']);

      expect(result).toEqual([
        null,
        { type: 'preference', confidence: 0.9, extract: 'Use tabs' },
        null,
      ]);
    });

    it('returns null when the result array length mismatches the input length', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify([
          { type: 'preference', confidence: 0.9, extract: 'Use tabs' },
        ]))
      );

      expect(await classifier.classifyBatchWithLLM(['a', 'b'])).toBeNull();
    });

    it('returns null when the response is not an array', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse('{"type":"preference","confidence":0.9,"extract":"Use tabs"}')
      );

      expect(await classifier.classifyBatchWithLLM(['a'])).toBeNull();
    });

    it('returns null when the SDK throws', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockRejectedValue(new Error('timeout'));

      expect(await classifier.classifyBatchWithLLM(['a'])).toBeNull();
    });
  });

  describe('extractSessionLearningsWithLLM', () => {
    it('returns null when ANTHROPIC_API_KEY is unset', async () => {
      const classifier = loadClassifier();

      expect(await classifier.extractSessionLearningsWithLLM('summary text', [])).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('filters invalid items and defaults confidence to 0.7', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify([
          { type: 'devops', content: 'Pipe y to scripts/upgrade-sandbox.sh', confidence: 0.9 },
          { type: 'not-a-valid-type', content: 'should be dropped entirely', confidence: 0.9 },
          { type: 'preference', content: 'tiny' },                       // too short (<=5 chars)
          { type: 'failure', content: 'Build needs npm install first' }, // no confidence -> 0.7
        ]))
      );

      const result = await classifier.extractSessionLearningsWithLLM(
        'session summary',
        ['existing memory one']
      );

      expect(result).toEqual([
        { type: 'devops', content: 'Pipe y to scripts/upgrade-sandbox.sh', confidence: 0.9 },
        { type: 'failure', content: 'Build needs npm install first', confidence: 0.7 },
      ]);

      // Existing memories are embedded in the system prompt to avoid duplicates
      expect(mockCreate.mock.calls[0][0].system).toContain('existing memory one');
    });

    it('returns null when the response is not an array', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(textResponse('{"type":"devops"}'));

      expect(await classifier.extractSessionLearningsWithLLM('summary', [])).toBeNull();
    });

    it('returns null when the SDK throws', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockRejectedValue(new Error('boom'));

      expect(await classifier.extractSessionLearningsWithLLM('summary', [])).toBeNull();
    });
  });

  describe('extractCheckpointWithLLM', () => {
    const LONG_SUMMARY = 'User asked to add a checkpoint feature; the agent implemented saveCheckpoint in storage.';

    it('returns null when ANTHROPIC_API_KEY is unset', async () => {
      const classifier = loadClassifier();

      expect(await classifier.extractCheckpointWithLLM(LONG_SUMMARY)).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns null for a too-short summary without calling the SDK', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();

      expect(await classifier.extractCheckpointWithLLM('short')).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns the parsed checkpoint, coercing non-string fields to empty strings', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify({
          completed: 'Added saveCheckpoint() to storage',
          remaining: 'Wire the CLI checkpoint command',
          blockers: 42, // non-string -> ''
        }))
      );

      const result = await classifier.extractCheckpointWithLLM(LONG_SUMMARY);

      expect(result).toEqual({
        completed: 'Added saveCheckpoint() to storage',
        remaining: 'Wire the CLI checkpoint command',
        blockers: '',
      });
    });

    it('returns null on a non-object response or SDK throw', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();

      mockCreate.mockResolvedValueOnce(textResponse('null'));
      expect(await classifier.extractCheckpointWithLLM(LONG_SUMMARY)).toBeNull();

      mockCreate.mockRejectedValueOnce(new Error('boom'));
      expect(await classifier.extractCheckpointWithLLM(LONG_SUMMARY)).toBeNull();
    });
  });

  describe('extractHindsightHint', () => {
    it('returns null when ANTHROPIC_API_KEY is unset', async () => {
      const classifier = loadClassifier();

      const result = await classifier.extractHindsightHint('build failed', 'npm run build');

      expect(result).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('returns the parsed hint on the happy path', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify({
          hint_text: 'Run npm install after changing package.json',
          hint_kind: 'failure_preventer',
          applies_when: ['dependency-change', 'build'],
        }))
      );

      const result = await classifier.extractHindsightHint(
        'build failed after dependency change',
        'npm run build exited 1'
      );

      expect(result).toEqual({
        hint_text: 'Run npm install after changing package.json',
        hint_kind: 'failure_preventer',
        applies_when: ['dependency-change', 'build'],
      });

      // The failure + context are both embedded in the user message
      const userMessage = mockCreate.mock.calls[0][0].messages[0].content;
      expect(userMessage).toContain('build failed after dependency change');
      expect(userMessage).toContain('npm run build exited 1');
    });

    it('returns null when hint_text is missing', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify({ hint_kind: 'rule', applies_when: [] }))
      );

      expect(await classifier.extractHindsightHint('failure', 'context')).toBeNull();
    });

    it('defaults applies_when to [] when absent or not an array', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockResolvedValue(
        textResponse(JSON.stringify({
          hint_text: 'Pin the Node version in CI',
          hint_kind: 'rule',
          applies_when: 'ci',
        }))
      );

      const result = await classifier.extractHindsightHint('CI failed', 'node mismatch');

      expect(result).toEqual({
        hint_text: 'Pin the Node version in CI',
        hint_kind: 'rule',
        applies_when: [],
      });
    });

    it('returns null when the SDK throws', async () => {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      const classifier = loadClassifier();
      mockCreate.mockRejectedValue(new Error('boom'));

      expect(await classifier.extractHindsightHint('failure', 'context')).toBeNull();
    });
  });
});
