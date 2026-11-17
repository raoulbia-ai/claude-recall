import { importSkipReason, MAX_IMPORT_VALUE_CHARS } from '../../src/cli/import-validation';

describe('importSkipReason', () => {
  it('accepts every type the system actually writes (export → import round trip)', () => {
    for (const type of ['preference', 'correction', 'devops', 'failure', 'project-knowledge',
      'solution', 'task-checkpoint', 'tool-use', 'imported']) {
      expect(importSkipReason({ type, value: 'x' })).toBeNull();
    }
  });

  it('defaults a missing type to imported', () => {
    expect(importSkipReason({ value: { content: 'x' } })).toBeNull();
  });

  it('rejects malformed types', () => {
    expect(importSkipReason({ type: 'Preference; DROP', value: 'x' })).toMatch(/invalid type/);
    expect(importSkipReason({ type: 42, value: 'x' })).toMatch(/invalid type/);
    expect(importSkipReason({ type: 'a'.repeat(65), value: 'x' })).toMatch(/invalid type/);
  });

  it('rejects oversized values, string or object', () => {
    expect(importSkipReason({ type: 'preference', value: 'x'.repeat(MAX_IMPORT_VALUE_CHARS + 1) })).toMatch(/too large/);
    expect(importSkipReason({ type: 'preference', value: { c: 'x'.repeat(MAX_IMPORT_VALUE_CHARS) } })).toMatch(/too large/);
    expect(importSkipReason({ type: 'preference', value: 'x'.repeat(MAX_IMPORT_VALUE_CHARS) })).toBeNull();
  });

  it('rejects non-objects and missing values', () => {
    expect(importSkipReason(null)).toBe('not an object');
    expect(importSkipReason('str')).toBe('not an object');
    expect(importSkipReason({ type: 'preference' })).toBe('missing value');
  });
});
