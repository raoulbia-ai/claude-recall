/**
 * Per-memory checks for `claude-recall import`. An import file is untrusted
 * input: whatever it holds is stored, and active rules are injected into every
 * future session's context.
 *
 * Types are checked by SHAPE, not against a fixed list: the type set is open
 * (storage never constrains it, e.g. `solution`, `task-checkpoint`), and an
 * export → import round trip must not silently drop real memories.
 */

/** Largest value accepted per memory. Real memories are well under 2KB. */
export const MAX_IMPORT_VALUE_CHARS = 10_000;

const TYPE_SHAPE = /^[a-z][a-z0-9-]{0,63}$/;

/** Returns why `memory` should be skipped, or null when it's acceptable. */
export function importSkipReason(memory: any): string | null {
  if (!memory || typeof memory !== 'object') return 'not an object';
  const type = memory.type ?? 'imported';
  if (typeof type !== 'string' || !TYPE_SHAPE.test(type)) {
    return `invalid type ${JSON.stringify(type).slice(0, 80)}`;
  }
  if (memory.value === undefined || memory.value === null) return 'missing value';
  const value = typeof memory.value === 'string' ? memory.value : JSON.stringify(memory.value);
  if (value.length > MAX_IMPORT_VALUE_CHARS) {
    return `value too large (${value.length} chars, max ${MAX_IMPORT_VALUE_CHARS})`;
  }
  return null;
}
