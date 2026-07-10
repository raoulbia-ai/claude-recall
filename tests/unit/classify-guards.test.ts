/**
 * Path-independent capture guards in classifyContent.
 *
 * The LLM classifiers (Haiku, Kiro) were trusted to reject conversation on
 * their own and didn't — Haiku stored real prompts like "what memories do you
 * have?" and a rambling chat message as preferences. These guards apply to
 * EVERY path: reject interrogatives/pleasantries up front, and reject any
 * result whose extract still contains a '?' (a distilled rule is declarative).
 */

// Mock all three LLM backends so we can assert the guards AND the backend
// ordering (which one gets consulted first) without any real API or CLI call.
const mockClassifyWithLLM = jest.fn();
const mockClassifyWithKiro = jest.fn();
const mockClassifyWithClaudeCli = jest.fn();
jest.mock('../../src/hooks/llm-classifier', () => ({
  classifyWithLLM: (...args: any[]) => mockClassifyWithLLM(...args),
  classifyBatchWithLLM: jest.fn(),
}));
jest.mock('../../src/hooks/kiro-classifier', () => ({
  classifyWithKiro: (...args: any[]) => mockClassifyWithKiro(...args),
}));
jest.mock('../../src/hooks/cc-classifier', () => ({
  classifyWithClaudeCli: (...args: any[]) => mockClassifyWithClaudeCli(...args),
}));

import { classifyContent, isConversationalNotRule } from '../../src/hooks/shared';

const RULE = { type: 'preference', confidence: 0.9, extract: 'Use tabs' };

describe('isConversationalNotRule', () => {
  it.each([
    'what claude recall memories do you have?',
    'does the db indeed have that noise stored?',
    'How do I clear the database?',
    'should we use tabs?',
    'no worries, that looks good',
    'no thanks',
  ])('flags conversation: %s', (text) => {
    expect(isConversationalNotRule(text)).toBe(true);
  });

  it.each([
    'Use tabs for indentation',
    'Always squash-merge PRs; never leave stacked PRs open',
    'I prefer green',
    'The API uses OAuth2',
  ])('allows a rule: %s', (text) => {
    expect(isConversationalNotRule(text)).toBe(false);
  });
});

describe('classifyContent guards', () => {
  // These guards are path-independent; the API-key backend (opt-in since
  // 0.33.0) is the test vehicle used to feed results through them.
  beforeEach(() => {
    mockClassifyWithLLM.mockReset();
    process.env.CLAUDE_RECALL_PREFER_API_KEY = '1';
  });
  afterAll(() => {
    delete process.env.CLAUDE_RECALL_PREFER_API_KEY;
  });

  it('rejects an interrogative before the LLM is even consulted', async () => {
    const result = await classifyContent('what claude recall memories do you have?');
    expect(result).toBeNull();
    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
  });

  it('rejects a result whose extract still contains a question mark', async () => {
    // Simulates Haiku echoing a question back as a "preference".
    mockClassifyWithLLM.mockResolvedValue({
      type: 'preference',
      confidence: 0.9,
      extract: 'does the db indeed have that noise stored?',
    });
    // Prompt itself doesn't trip the interrogative guard (starts mid-sentence,
    // ends on a statement) — so it reaches the LLM and the extract guard fires.
    const result = await classifyContent('line on my question. it should be fixed.');
    expect(mockClassifyWithLLM).toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('passes a clean declarative rule through', async () => {
    mockClassifyWithLLM.mockResolvedValue({
      type: 'preference',
      confidence: 0.9,
      extract: 'Favourite colour is green',
    });
    const result = await classifyContent('my favourite colour is green');
    expect(result).toEqual({
      type: 'preference',
      confidence: 0.9,
      extract: 'Favourite colour is green',
    });
  });
});

describe('classifyContent backend precedence', () => {
  const saved = {
    kiro: process.env.CLAUDE_RECALL_KIRO_CLASSIFIER,
    cc: process.env.CLAUDE_RECALL_CC_CLASSIFIER,
    preferKey: process.env.CLAUDE_RECALL_PREFER_API_KEY,
  };
  beforeEach(() => {
    mockClassifyWithLLM.mockReset().mockResolvedValue(RULE);
    mockClassifyWithKiro.mockReset().mockResolvedValue(RULE);
    mockClassifyWithClaudeCli.mockReset().mockResolvedValue(RULE);
    delete process.env.CLAUDE_RECALL_KIRO_CLASSIFIER;
    delete process.env.CLAUDE_RECALL_CC_CLASSIFIER;
    delete process.env.CLAUDE_RECALL_PREFER_API_KEY;
  });
  afterAll(() => {
    if (saved.kiro === undefined) delete process.env.CLAUDE_RECALL_KIRO_CLASSIFIER;
    else process.env.CLAUDE_RECALL_KIRO_CLASSIFIER = saved.kiro;
    if (saved.cc === undefined) delete process.env.CLAUDE_RECALL_CC_CLASSIFIER;
    else process.env.CLAUDE_RECALL_CC_CLASSIFIER = saved.cc;
    if (saved.preferKey === undefined) delete process.env.CLAUDE_RECALL_PREFER_API_KEY;
    else process.env.CLAUDE_RECALL_PREFER_API_KEY = saved.preferKey;
  });

  it('inline (no worker flag): consults NO LLM backend — straight to regex', async () => {
    const result = await classifyContent('always use tabs');
    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
    expect(mockClassifyWithKiro).not.toHaveBeenCalled();
    expect(mockClassifyWithClaudeCli).not.toHaveBeenCalled();
    // The regex fallback still classifies it
    expect(result?.type).toBe('preference');
  });

  it('inline + CLAUDE_RECALL_PREFER_API_KEY: the key backend is enabled', async () => {
    process.env.CLAUDE_RECALL_PREFER_API_KEY = '1';
    await classifyContent('always use tabs');
    expect(mockClassifyWithLLM).toHaveBeenCalled();
  });

  it('under Kiro: prefers the Kiro LLM over a stray API key', async () => {
    process.env.CLAUDE_RECALL_KIRO_CLASSIFIER = '1';
    await classifyContent('always use tabs');
    expect(mockClassifyWithKiro).toHaveBeenCalled();
    // Kiro returned a rule, so the API key backend is never consulted.
    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
  });

  it('under Kiro: does NOT fall back to a set API key — regex instead (opt-in policy)', async () => {
    process.env.CLAUDE_RECALL_KIRO_CLASSIFIER = '1';
    mockClassifyWithKiro.mockResolvedValue(null);
    const result = await classifyContent('always use tabs');
    expect(mockClassifyWithKiro).toHaveBeenCalled();
    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
    expect(result?.type).toBe('preference'); // regex fallback
  });

  it('CLAUDE_RECALL_PREFER_API_KEY flips the order back to key-first under Kiro', async () => {
    process.env.CLAUDE_RECALL_KIRO_CLASSIFIER = '1';
    process.env.CLAUDE_RECALL_PREFER_API_KEY = '1';
    await classifyContent('always use tabs');
    expect(mockClassifyWithLLM).toHaveBeenCalled();
    expect(mockClassifyWithKiro).not.toHaveBeenCalled();
  });

  it('in the CC worker: prefers the Claude subscription CLI over a stray API key', async () => {
    process.env.CLAUDE_RECALL_CC_CLASSIFIER = '1';
    await classifyContent('always use tabs');
    expect(mockClassifyWithClaudeCli).toHaveBeenCalled();
    // The CLI returned a rule, so the API key backend is never consulted.
    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
  });

  it('in the CC worker: does NOT fall back to a set API key — regex instead (opt-in policy)', async () => {
    process.env.CLAUDE_RECALL_CC_CLASSIFIER = '1';
    mockClassifyWithClaudeCli.mockResolvedValue(null);
    const result = await classifyContent('always use tabs');
    expect(mockClassifyWithClaudeCli).toHaveBeenCalled();
    expect(mockClassifyWithLLM).not.toHaveBeenCalled();
    expect(result?.type).toBe('preference'); // regex fallback
  });

  it('CLAUDE_RECALL_PREFER_API_KEY flips the order back to key-first in the CC worker', async () => {
    process.env.CLAUDE_RECALL_CC_CLASSIFIER = '1';
    process.env.CLAUDE_RECALL_PREFER_API_KEY = '1';
    await classifyContent('always use tabs');
    expect(mockClassifyWithLLM).toHaveBeenCalled();
    expect(mockClassifyWithClaudeCli).not.toHaveBeenCalled();
  });
});
