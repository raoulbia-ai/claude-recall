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
  });
});
