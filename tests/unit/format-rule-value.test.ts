import { formatRuleValue } from '../../src/mcp/tools/memory-tools';

/**
 * Regression test for the [object Object] bug in handleLoadRules.
 *
 * The previous rendering did:
 *   const val = typeof m.value === 'object'
 *     ? (m.value.content || m.value.value || JSON.stringify(m.value))
 *     : m.value;
 *
 * When m.value.content was itself a non-empty object (e.g. tool-outcome-watcher
 * failures storing { title, description, content: { what_failed, why_failed, ... } }),
 * the OR short-circuit returned the object directly. String interpolation then
 * called toString() → "[object Object]". Reproduced live in v0.21.0 load_rules
 * output during the v0.21.0 dogfood test.
 *
 * formatRuleValue is a pure helper that must produce a readable string for
 * every value shape that lands in the memories table. No shape should ever
 * stringify as "[object Object]".
 */
describe('formatRuleValue', () => {
  test('plain string passes through', () => {
    expect(formatRuleValue('use tabs')).toBe('use tabs');
  });

  test('null/undefined → empty string', () => {
    expect(formatRuleValue(null)).toBe('');
    expect(formatRuleValue(undefined)).toBe('');
  });

  test('number coerced to string', () => {
    expect(formatRuleValue(42)).toBe('42');
  });

  test('shape A — legacy hook failure with string content', () => {
    const value = {
      content: 'Node.js -e flag cannot parse multiline strings',
      confidence: 0.8,
      source: 'hook-auto-capture',
      timestamp: 1772637495154,
    };
    expect(formatRuleValue(value)).toBe('Node.js -e flag cannot parse multiline strings');
  });

  test('shape B — tool-outcome-watcher failure with NESTED object content (the [object Object] bug)', () => {
    // This is the exact shape reproduced from
    // hook_failure_silent-test-failure_1775896172743_2agjfddk4 in the live DB.
    const value = {
      title: 'Avoid: Test command reported failures: npx jest tests/uni',
      description: 'FAIL tests/unit/pi-extension.test.ts',
      content: {
        what_failed: 'Test command reported failures: npx jest tests/unit/pi-extension.test.ts',
        why_failed: 'FAIL tests/unit/pi-extension.test.ts',
        what_should_do: 'Read test output and fix failing assertions',
        context: 'Test run',
        preventative_checks: ['Run tests locally before committing'],
      },
    };
    const result = formatRuleValue(value);
    expect(result).not.toBe('[object Object]');
    expect(result).not.toContain('[object Object]');
    // Should fall back to title since content is an object
    expect(result).toBe('Avoid: Test command reported failures: npx jest tests/uni');
  });

  test('shape C — promoted lesson with string content (lesson takes precedence over title)', () => {
    const value = {
      title: 'Learned: Read test output carefully',
      description: 'Promoted from 3 observation(s)',
      content: 'Read test output carefully — exit code 0 does not mean all tests passed',
      source: 'promotion-engine',
      lesson_kind: 'failure_preventer',
      evidence_count: 3,
    };
    expect(formatRuleValue(value)).toBe(
      'Read test output carefully — exit code 0 does not mean all tests passed'
    );
  });

  test('shape D — content field is stringified JSON (legacy ugly shape)', () => {
    const value = {
      content: '{"what_failed":"Bash command failed","why_failed":"Exit code 1"}',
      timestamp: 1775840685750,
    };
    // We accept the ugly stringified JSON for now — the important guarantee is
    // it doesn't crash or produce [object Object].
    const result = formatRuleValue(value);
    expect(typeof result).toBe('string');
    expect(result).toContain('what_failed');
  });

  test('shape E — bare what_failed at top level', () => {
    const value = {
      what_failed: 'Build broke on missing import',
      why_failed: 'TypeError',
    };
    expect(formatRuleValue(value)).toBe('Build broke on missing import');
  });

  test('shape F — only nested content.what_failed available', () => {
    const value = {
      content: { what_failed: 'Bash command failed: npm publish', why_failed: 'EACCES' },
    };
    const result = formatRuleValue(value);
    expect(result).not.toContain('[object Object]');
    expect(result).toBe('Bash command failed: npm publish');
  });

  test('empty object → readable fallback (not [object Object])', () => {
    expect(formatRuleValue({})).not.toBe('[object Object]');
  });

  test('preference shape with .value as string', () => {
    const value = { value: 'Always use TypeScript', sessionId: 'abc' };
    expect(formatRuleValue(value)).toBe('Always use TypeScript');
  });

  test('huge JSON gets truncated, not crashed', () => {
    const huge: any = {};
    for (let i = 0; i < 100; i++) huge[`key${i}`] = `value${i}`.repeat(20);
    const result = formatRuleValue(huge);
    expect(typeof result).toBe('string');
    expect(result.length).toBeLessThanOrEqual(220); // 200 + ellipsis budget
    expect(result).not.toContain('[object Object]');
  });
});
