/**
 * Test-pollution patterns — values produced by legacy unit/integration test fixtures
 * that leaked into the production memory DB. Centralized here so the write-time guard
 * (MemoryService.store) and the cleanup command (MemoryStorage.deleteTestPollution)
 * never drift.
 *
 * If you legitimately want to test the store path, use values that don't match these
 * patterns (e.g. fixture strings that include the test name, not "Test preference 177…").
 */

export const TEST_POLLUTION_REGEXES: RegExp[] = [
  /^Test preference \d+/i,
  /^Session test preference \d+/i,
  /^Memory with complex metadata$/i,
  /^Test memory content$/i,
];

/**
 * SQL LIKE patterns (case-insensitive via COLLATE NOCASE) mirroring the regexes above.
 * better-sqlite3 has no regex built-in; LIKE is enough for these anchored prefixes.
 */
export const TEST_POLLUTION_LIKE: string[] = [
  'Test preference 1%',
  'Session test preference 1%',
  'Memory with complex metadata',
  'Test memory content',
];

function extractContentString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.content === 'string') return v.content;
    if (typeof v.value === 'string') return v.value;
    if (typeof v.title === 'string') return v.title;
  }
  return '';
}

/**
 * Returns true if the provided memory value looks like test-fixture pollution.
 * Only string-ish payloads are inspected; structured rules with real content pass through.
 */
export function isTestPollution(value: unknown): boolean {
  const str = extractContentString(value);
  if (!str) return false;
  return TEST_POLLUTION_REGEXES.some(rx => rx.test(str));
}
