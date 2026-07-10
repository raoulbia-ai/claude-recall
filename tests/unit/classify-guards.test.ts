/**
 * Path-independent capture guards in classifyContent.
 *
 * The LLM classifiers (Haiku, Kiro) were trusted to reject conversation on
 * their own and didn't — Haiku stored real prompts like "what memories do you
 * have?" and a rambling chat message as preferences. These guards apply to
 * EVERY path: reject interrogatives/pleasantries up front, and reject any
 * result whose extract still contains a '?' (a distilled rule is declarative).
 */

// Mock the Haiku classifier so we can force a "the LLM said this is a rule"
// result and prove the guards catch it regardless of what the model returns.
const mockClassifyWithLLM = jest.fn();
jest.mock('../../src/hooks/llm-classifier', () => ({
  classifyWithLLM: (...args: any[]) => mockClassifyWithLLM(...args),
  classifyBatchWithLLM: jest.fn(),
}));

import { classifyContent, isConversationalNotRule } from '../../src/hooks/shared';

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
  beforeEach(() => mockClassifyWithLLM.mockReset());

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
