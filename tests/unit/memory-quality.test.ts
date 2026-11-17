/**
 * The shared low-signal predicate. Previously this logic lived only inside the
 * memory-sync hook, so the file index filtered boilerplate failures while
 * loadActiveRules (injection, load_rules, statusline) still counted them —
 * producing contradictory surfaces ("3 rules" vs "No recall rules synced").
 */
import { isBoilerplateFailureValue, BOILERPLATE_LESSONS } from '../../src/services/memory-quality';

describe('isBoilerplateFailureValue', () => {
  it('flags failures whose only takeaway is a generic default', () => {
    for (const lesson of BOILERPLATE_LESSONS) {
      expect(isBoilerplateFailureValue({ what_failed: 'x', what_should_do: lesson })).toBe(true);
    }
    // case/whitespace tolerant
    expect(isBoilerplateFailureValue({
      what_failed: 'x', what_should_do: '  Check Inputs And Prerequisites Before Retrying ',
    })).toBe(true);
  });

  it('keeps failures that carry a specific, actionable lesson', () => {
    expect(isBoilerplateFailureValue({
      what_failed: 'commit failed', what_should_do: 'Commit with --no-gpg-sign in WSL',
    })).toBe(false);
  });

  it('unwraps nested and stringified shapes', () => {
    const boiler = { what_failed: 'x', what_should_do: 'review error details and adjust approach' };
    expect(isBoilerplateFailureValue({ content: boiler })).toBe(true);
    expect(isBoilerplateFailureValue(JSON.stringify(boiler))).toBe(true);
    expect(isBoilerplateFailureValue({ content: JSON.stringify(boiler) })).toBe(true);
  });

  it('is false for anything that is not a failure shape', () => {
    expect(isBoilerplateFailureValue('use pnpm not npm')).toBe(false);
    expect(isBoilerplateFailureValue({ content: 'a preference' })).toBe(false);
    expect(isBoilerplateFailureValue(null)).toBe(false);
  });
});
