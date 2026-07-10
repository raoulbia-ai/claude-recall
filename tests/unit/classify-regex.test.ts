/**
 * Tests for the regex fallback classifier (used when no ANTHROPIC_API_KEY).
 *
 * Two invariants:
 * 1. Every pattern's confidence must clear the >= 0.75 gate consumers apply —
 *    a sub-threshold pattern is silently dead code.
 * 2. Questions and pleasantries must never classify as rules.
 */
import { classifyContentRegex } from '../../src/hooks/shared';

describe('classifyContentRegex', () => {
  describe('corrections', () => {
    it('classifies "no, ..." directives as corrections', () => {
      const r = classifyContentRegex('no, use tabs instead of spaces in this repo');
      expect(r?.type).toBe('correction');
      expect(r!.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('classifies "never ..." as a correction above the consumer gate', () => {
      const r = classifyContentRegex('never commit directly to the main branch');
      expect(r?.type).toBe('correction');
      expect(r!.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('classifies "stop using ..." above the consumer gate', () => {
      const r = classifyContentRegex('stop using var declarations in new code');
      expect(r?.type).toBe('correction');
      expect(r!.confidence).toBeGreaterThanOrEqual(0.75);
    });
  });

  describe('preferences', () => {
    it('classifies "always ..." above the consumer gate', () => {
      const r = classifyContentRegex('always run the linter before committing');
      expect(r?.type).toBe('preference');
      expect(r!.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('classifies "I prefer ..." above the consumer gate', () => {
      const r = classifyContentRegex('I prefer named exports over default exports');
      expect(r?.type).toBe('preference');
      expect(r!.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('classifies "remember to ..." as a preference', () => {
      const r = classifyContentRegex('remember to bump the schema version when adding columns');
      expect(r?.type).toBe('preference');
    });

    it('classifies bare "remember ..." phrasings (no that/this/to)', () => {
      // Real-world miss: "remember my favourite color is green" slipped past
      // the old regex, which required that/this/to after "remember"
      const r = classifyContentRegex('remember my favourite color is green');
      expect(r?.type).toBe('preference');
      expect(r?.extract).toBe('my favourite color is green');
      expect(r!.confidence).toBeGreaterThanOrEqual(0.75);

      const r2 = classifyContentRegex('remember we deploy only from the release branch');
      expect(r2?.type).toBe('preference');
    });

    it('classifies "recall ..." store requests (resilient path for MCP-blocked Kiro)', () => {
      // Real-world miss under enterprise Kiro governance: MCP tools blocked,
      // no API key in the hook env, and "recall ..." matched no pattern
      const r = classifyContentRegex('recall my favourite color is green');
      expect(r?.type).toBe('preference');
      expect(r?.extract).toBe('my favourite color is green');
      expect(r!.confidence).toBeGreaterThanOrEqual(0.75);
    });

    it('does not classify "do you recall ...?" questions', () => {
      expect(classifyContentRegex('do you recall which branch we deployed from?')).toBeNull();
    });
  });

  describe('misfire guards', () => {
    it('does not classify pleasantries as corrections', () => {
      expect(classifyContentRegex('no worries, that looks good to me')).toBeNull();
      expect(classifyContentRegex('no problem, take your time with it')).toBeNull();
    });

    it('does not classify questions as rules', () => {
      expect(classifyContentRegex('do you remember that config file we used last week?')).toBeNull();
      expect(classifyContentRegex('should I always run the tests before pushing?')).toBeNull();
      expect(classifyContentRegex('what happens if we never call close on the db')).toBeNull();
    });

    it('does not classify weak conversational signals', () => {
      // These patterns were deleted: they matched ordinary conversation
      expect(classifyContentRegex('I want to fix this bug before lunch')).toBeNull();
      expect(classifyContentRegex('I like how this turned out')).toBeNull();
      expect(classifyContentRegex('I use the terminal for most things')).toBeNull();
      expect(classifyContentRegex('actually let me look at the other file first')).toBeNull();
    });

    // Regression: four real junk memories stored in one session of talking
    // ABOUT claude-recall — each traced to a specific over-broad pattern.
    it('does not fire "recall" inside the product name claude-recall / claude recall', () => {
      // Stored "is used in practice" (from "how claude recall is used in practice")
      expect(classifyContentRegex(
        'there should be a worked example that illustrates how claude recall is used in practice'
      )).toBeNull();
      // Stored "→ then claude-recall kiro setup." (from a pasted install line)
      expect(classifyContentRegex(
        'Install: npm install -g claude-recall → then claude-recall kiro setup.'
      )).toBeNull();
    });

    it('does not fire "never" mid-clause on quoted/pasted text', () => {
      // Stored "touches your token allowance..." as a correction
      expect(classifyContentRegex(
        'bit of a contradiction here: it uses the included model, so it never touches your token allowance. The only cost is 0.06 credits'
      )).toBeNull();
      // But sentence-initial "never" still works, including after a full stop
      expect(classifyContentRegex('That was wrong of me. Never commit directly to main')?.type).toBe('correction');
    });

    it('does not classify "no <one-off task imperative>" as a correction', () => {
      // Stored "first fix the sentence" as a correction
      expect(classifyContentRegex('no first fix the sentence')).toBeNull();
      // But "no, ..." with a durable-rule signal still classifies
      expect(classifyContentRegex('no, use helm not kubectl for deploys')?.type).toBe('correction');
    });

    it('does not fire imperative "recall" when it reads as a noun/subject', () => {
      expect(classifyContentRegex('please note the recall is broken again today')).toBeNull();
      // Imperative "recall X" still works
      expect(classifyContentRegex('recall the deploy pipeline uses helm')?.type).toBe('preference');
    });
  });
});
