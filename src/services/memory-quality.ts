/**
 * Shared memory-quality predicates.
 *
 * These were previously implemented only inside the memory-sync hook, which
 * meant one surface (the file-based MEMORY.md index) filtered low-signal
 * failures while every other surface (loadActiveRules → rule injection,
 * load_rules, the statusline) still counted and injected them. That produced
 * contradictory signals — a statusline reading "3 rules" next to an index
 * saying "No recall rules synced". One predicate, applied everywhere.
 */

/**
 * Generic default "lessons" the failure detectors emit when no fix has been
 * paired yet. A memory whose only takeaway is one of these teaches nothing —
 * it just costs context. The specific failure still lives in the DB, so
 * fix-pairing and evidence counting are unaffected; once a fix enriches
 * what_should_do the memory becomes useful again.
 */
export const BOILERPLATE_LESSONS = new Set([
  'check inputs and prerequisites before retrying',
  'check command syntax, file paths, and prerequisites before running',
  'review error details and adjust approach',
]);

/** Unwrap a memory value to the object that carries the failure fields, or null. */
export function unwrapToFailureObject(value: any): any {
  let v: any = value;
  for (let depth = 0; depth < 6; depth++) {
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.startsWith('{')) { try { v = JSON.parse(t); continue; } catch { return null; } }
      return null;
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (typeof v.what_should_do === 'string' || typeof v.what_failed === 'string') return v;
      const next = v.content ?? v.value;
      if (next === undefined) return null;
      v = next;
      continue;
    }
    return null;
  }
  return null;
}

/**
 * True when a failure memory's only takeaway is boilerplate — i.e. it teaches
 * nothing and should neither be injected, counted, nor synced.
 */
export function isBoilerplateFailureValue(value: any): boolean {
  const obj = unwrapToFailureObject(value);
  const wsd = obj && typeof obj.what_should_do === 'string' ? obj.what_should_do.trim().toLowerCase() : '';
  return BOILERPLATE_LESSONS.has(wsd);
}
