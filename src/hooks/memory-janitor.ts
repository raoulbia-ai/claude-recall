/**
 * Memory janitor — LLM-driven hygiene pass over the stored rule corpus.
 *
 * The deterministic hygiene passes judge rules by counters (auto-demote:
 * loaded often + never cited; auto-dedup: textual similarity). Counters can
 * say "unused" but not "this is noise", "these five platitudes are one rule",
 * or "this preference is actually a conversational fragment the classifier
 * misfiled". This pass gives that judgment to the runtime's own LLM — the
 * same backend policy as capture classification (claude -p on the user's
 * subscription under Claude Code, kiro-cli on Kiro credits under Kiro, and
 * NEVER a personally-exported ANTHROPIC_API_KEY unless the user opted in).
 *
 * Design guardrails:
 *  - Never deletes. Demotes with superseded_by='janitor' — reversible via
 *    `rules promote <id>`, and re-teaching identical content revives the row.
 *  - Grace period: memories younger than 24h are not even shown to the LLM,
 *    so one session's janitor can't erase what the previous session just
 *    learned.
 *  - Capped at 10 actions per run; malformed LLM output is a no-op.
 *  - Rate-limited to one run per 24h (state file), spawned as a DETACHED
 *    worker from existing session hooks — never blocks a turn, and users get
 *    it on upgrade with no config change.
 *
 * Disable with CLAUDE_RECALL_JANITOR=off. Tune with
 * CLAUDE_RECALL_JANITOR_INTERVAL_HOURS / CLAUDE_RECALL_JANITOR_GRACE_HOURS.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { hookLog, hookStateDir, jaccardSimilarity, safeErrorMessage, storeMemory } from './shared';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { formatRuleValue } from '../mcp/tools/memory-tools';

const HOOK_NAME = 'memory-janitor';
const STATE_FILE = 'janitor-state.json';
const REPORT_FILE = 'janitor-last-report.json';

const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_GRACE_HOURS = 24;
const MAX_ACTIONS_PER_RUN = 10;
/** Review pass is one bigger completion than classification — allow more time. */
const JANITOR_TIMEOUT_MS = 60000;

const RULE_TYPES = new Set(['preference', 'correction', 'failure', 'devops', 'project-knowledge']);

export interface JanitorAction {
  action: 'demote' | 'merge' | 'rewrite';
  ids: number[];
  replacement?: string;
  type?: string;
  reason: string;
}

export interface JanitorReport {
  timestamp: number;
  runtime: string;
  reviewed: number;
  actions: Array<JanitorAction & { applied: boolean }>;
  dryRun: boolean;
}

function janitorDisabled(): boolean {
  const v = (process.env.CLAUDE_RECALL_JANITOR || '').trim().toLowerCase();
  return v === 'off' || v === 'false' || v === '0';
}

function envHours(name: string, fallback: number): number {
  const n = parseFloat(process.env[name] || '');
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Rate limiter with claim-on-check semantics: the caller that sees the
 * interval elapsed WRITES the new timestamp before spawning, so several
 * sessions starting in the same minute produce one janitor run, not one each.
 */
export function claimJanitorRun(nowMs: number = Date.now()): boolean {
  const intervalMs = envHours('CLAUDE_RECALL_JANITOR_INTERVAL_HOURS', DEFAULT_INTERVAL_HOURS) * 3600000;
  const statePath = path.join(hookStateDir(), STATE_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    if (typeof raw?.lastRun === 'number' && nowMs - raw.lastRun < intervalMs) {
      return false;
    }
  } catch { /* missing/corrupt state = never ran */ }
  try {
    fs.writeFileSync(statePath, JSON.stringify({ lastRun: nowMs }));
  } catch (err) {
    // If the claim can't be persisted, don't run — an unwritable state file
    // would otherwise mean a janitor pass on EVERY session start.
    hookLog(HOOK_NAME, `state write failed, skipping run: ${safeErrorMessage(err)}`);
    return false;
  }
  return true;
}

/**
 * The inline half — called from existing session hooks (kiro-agent-spawn,
 * cc-capture). Decides eligibility and spawns the detached worker. Returns in
 * milliseconds; never throws.
 */
export function maybeSpawnJanitor(input: any, runtime: 'cc' | 'kiro'): void {
  try {
    if (janitorDisabled()) return;
    // Recursion guard — a nested headless session must never run hygiene.
    if (
      process.env.CLAUDE_RECALL_NESTED
      || process.env.CLAUDE_RECALL_CC_CLASSIFIER
      || process.env.CLAUDE_RECALL_KIRO_CLASSIFIER
      || process.env.CLAUDE_RECALL_JANITOR_WORKER
    ) {
      return;
    }
    if (!claimJanitorRun()) return;

    const cliPath = process.argv[1];
    const child = spawn(
      process.execPath,
      [cliPath, 'hook', 'run', 'memory-janitor-worker'],
      {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        env: { ...process.env, CLAUDE_RECALL_JANITOR_RUNTIME: runtime },
      },
    );
    child.on('error', (err) => {
      hookLog(HOOK_NAME, `worker spawn error: ${err?.message ?? err}`);
    });
    if (child.stdin) {
      child.stdin.on('error', (err) => {
        hookLog(HOOK_NAME, `worker stdin error: ${err?.message ?? err}`);
      });
      child.stdin.write(JSON.stringify(input ?? {}));
      child.stdin.end();
    }
    child.unref();
    hookLog(HOOK_NAME, `spawned detached janitor worker (pid=${child.pid}, runtime=${runtime})`);
  } catch (err) {
    hookLog(HOOK_NAME, `spawn failed: ${safeErrorMessage(err)}`);
  }
}

/** Threshold above which a rewrite is judged cosmetic and dropped. */
const REWRITE_MIN_CHANGE_SIMILARITY = 0.8;

/** Extract a rule's display text from its stored value. */
function ruleText(rule: { value: string }): string {
  try {
    return formatRuleValue(JSON.parse(rule.value));
  } catch {
    return String(rule.value);
  }
}

/** Render one rule for the review prompt — id, type, counters, age, text. */
function renderRuleForReview(
  rule: { id: number; type: string; value: string; load_count: number; cite_count: number; timestamp: number },
  nowMs: number,
): string {
  const ageDays = Math.max(0, Math.round((nowMs - rule.timestamp) / 86400000));
  return JSON.stringify({
    id: rule.id,
    type: rule.type,
    loads: rule.load_count,
    cites: rule.cite_count,
    age_days: ageDays,
    text: ruleText(rule).slice(0, 400),
  });
}

/**
 * Deterministic backstop against cosmetic rewrites: whatever the LLM claims,
 * a rewrite whose replacement is near-identical to the original changes
 * nothing at decision time and just churns the row. Observed live on the
 * first wild run ("already specific and actionable; minor clarification
 * only" — and it rewrote anyway).
 */
export function dropCosmeticRewrites(
  actions: JanitorAction[],
  textById: Map<number, string>,
): JanitorAction[] {
  return actions.filter((a) => {
    if (a.action !== 'rewrite') return true;
    const original = textById.get(a.ids[0]) ?? '';
    const similarity = jaccardSimilarity(original, a.replacement ?? '');
    if (similarity >= REWRITE_MIN_CHANGE_SIMILARITY) {
      hookLog(HOOK_NAME, `dropped cosmetic rewrite [${a.ids[0]}] (similarity=${similarity.toFixed(2)})`);
      return false;
    }
    return true;
  });
}

export function buildJanitorPrompt(ruleLines: string[]): string {
  return (
    'You are a memory hygiene reviewer for a developer tool. Below are rules a ' +
    'coding agent stored automatically from past sessions. Some are valuable; ' +
    'some are noise that pollutes every future session. Review them and respond ' +
    'with ONLY minified JSON — no markdown, no prose, no code fence:\n' +
    '{"actions":[{"action":"demote|merge|rewrite","ids":[<id>,...],"replacement":"<text or empty>","reason":"<short>"}]}\n\n' +
    'Actions:\n' +
    '- demote: the rule is NOISE. Conversational fragments or meta-discussion ' +
    'misfiled as rules, statements about this tool or this chat, truncated/' +
    'malformed junk, or generic platitudes with zero actionable content (e.g. ' +
    '"check inputs before retrying" — advice so obvious no agent needs it stored).\n' +
    '- merge: two or more rules say the SAME thing in different words. ids = all ' +
    'of them; replacement = the single best phrasing (may combine details).\n' +
    '- rewrite: the rule is real but too vague to act on at the moment of ' +
    'decision. ids = [the one id]; replacement = a precise version naming the ' +
    'TRIGGER and the CONCRETE pattern, e.g. "When creating a new file, match ' +
    'the naming prefix of similar files — email files are email_*.txt".\n\n' +
    'Be conservative:\n' +
    '- When unsure, DO NOTHING with that rule. An empty actions array is a valid answer.\n' +
    '- If a rule is ALREADY precise, do not rewrite it. A cosmetic rephrasing or ' +
    '"minor clarification" is not an action — rewrite ONLY when the current wording ' +
    'would fail to trigger at the moment of decision.\n' +
    '- Never rewrite meaning — only clarity. Never merge rules that differ in substance.\n' +
    '- Specific, actionable rules are valuable even if rarely used. Low usage counters alone are NOT grounds to demote.\n' +
    '- Do not demote failure lessons that name a specific command, file, or error.\n\n' +
    'Rules to review (JSON per line):\n' +
    ruleLines.join('\n')
  );
}

/**
 * Parse and validate the LLM's response. Anything malformed is dropped;
 * unknown ids are dropped; the total is capped. A parse failure returns [] —
 * the janitor never guesses.
 */
export function parseJanitorActions(raw: string, validIds: Set<number>): JanitorAction[] {
  let parsed: any;
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) return [];
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.actions)) return [];

  const out: JanitorAction[] = [];
  for (const a of parsed.actions) {
    if (out.length >= MAX_ACTIONS_PER_RUN) break;
    if (!a || typeof a !== 'object') continue;
    if (a.action !== 'demote' && a.action !== 'merge' && a.action !== 'rewrite') continue;

    const ids: number[] = Array.isArray(a.ids)
      ? a.ids.filter((id: any) => Number.isInteger(id) && validIds.has(id))
      : [];
    if (ids.length === 0) continue;

    const replacement = typeof a.replacement === 'string' ? a.replacement.trim() : '';
    if (a.action === 'merge') {
      if (ids.length < 2) continue;
      if (replacement.length < 10 || replacement.length > 300) continue;
    }
    if (a.action === 'rewrite') {
      if (ids.length !== 1) continue;
      if (replacement.length < 10 || replacement.length > 300) continue;
      // A rewrite that doesn't change the text is a no-op dressed as work.
    }

    out.push({
      action: a.action,
      ids,
      replacement: replacement || undefined,
      type: typeof a.type === 'string' && RULE_TYPES.has(a.type) ? a.type : undefined,
      reason: typeof a.reason === 'string' ? a.reason.slice(0, 200) : '',
    });
  }
  return out;
}

/**
 * Apply validated actions. merge/rewrite store the replacement FIRST, then
 * demote the sources — if the store throws, the originals survive untouched.
 */
export function applyJanitorActions(
  actions: JanitorAction[],
  rulesById: Map<number, { id: number; type: string }>,
  opts: { dryRun?: boolean } = {},
): Array<JanitorAction & { applied: boolean }> {
  const storage = MemoryService.getInstance().getStorage();
  const results: Array<JanitorAction & { applied: boolean }> = [];

  for (const action of actions) {
    let applied = false;
    try {
      if (!opts.dryRun) {
        if (action.action === 'merge' || action.action === 'rewrite') {
          const type = action.type ?? rulesById.get(action.ids[0])?.type ?? 'preference';
          // fuzzyNewestWins: without it, a replacement similar to the rule it
          // replaces gets absorbed into that still-active row by fuzzy dedup —
          // then the demote below would destroy both versions.
          storeMemory(action.replacement!, type, undefined, 0.9, { fuzzyNewestWins: true });
        }
        const demoted = storage.demoteRulesByIds(action.ids, 'janitor');
        // For merge/rewrite the store above already succeeded (no throw), and
        // newest-wins supersession may have retired the source row before the
        // demote ran (changes=0) — the action still applied.
        applied = action.action === 'demote' ? demoted > 0 : true;
      } else {
        applied = true; // would apply
      }
    } catch (err) {
      hookLog(HOOK_NAME, `apply ${action.action} [${action.ids.join(',')}] failed: ${safeErrorMessage(err)}`);
    }
    results.push({ ...action, applied });
  }
  return results;
}

/** Route one completion through the runtime's own LLM. Null = no backend. */
async function completeForJanitor(prompt: string, runtime: string): Promise<string | null> {
  if (runtime === 'kiro') {
    const { completeWithKiroCli } = await import('./kiro-classifier');
    return completeWithKiroCli(prompt, { timeoutMs: JANITOR_TIMEOUT_MS });
  }
  if (runtime === 'cc') {
    const { completeWithClaudeCli } = await import('./cc-classifier');
    return completeWithClaudeCli(prompt, { timeoutMs: JANITOR_TIMEOUT_MS });
  }
  return null;
}

/**
 * The worker half — runs detached (or inline via `claude-recall janitor`).
 * Loads the corpus, asks the runtime's LLM for hygiene actions, applies them,
 * and writes a report file the CLI can display.
 */
export async function handleMemoryJanitorWorker(
  _input: any,
  opts: { dryRun?: boolean; runtime?: string } = {},
): Promise<JanitorReport | null> {
  // Mark this process so any hooks fired by the nested LLM call stay inert.
  process.env.CLAUDE_RECALL_JANITOR_WORKER = '1';
  const runtime = opts.runtime || process.env.CLAUDE_RECALL_JANITOR_RUNTIME || 'cc';

  try {
    const storage = MemoryService.getInstance().getStorage();
    const projectId = ConfigService.getInstance().getProjectId();
    const now = Date.now();
    const graceMs = envHours('CLAUDE_RECALL_JANITOR_GRACE_HOURS', DEFAULT_GRACE_HOURS) * 3600000;

    const all = storage.getActiveRules(projectId);
    const reviewable = all.filter(r => now - r.timestamp > graceMs);
    if (reviewable.length < 2) {
      hookLog(HOOK_NAME, `nothing to review (${all.length} active, ${reviewable.length} past grace period)`);
      return null;
    }

    const prompt = buildJanitorPrompt(reviewable.map(r => renderRuleForReview(r, now)));
    const raw = await completeForJanitor(prompt, runtime);
    if (raw === null) {
      hookLog(HOOK_NAME, `no LLM backend available (runtime=${runtime}) — skipping`);
      return null;
    }

    const validIds = new Set(reviewable.map(r => r.id));
    const textById = new Map(reviewable.map(r => [r.id, ruleText(r)]));
    const actions = dropCosmeticRewrites(parseJanitorActions(raw, validIds), textById);
    hookLog(HOOK_NAME, `reviewed ${reviewable.length} rules → ${actions.length} action(s)${opts.dryRun ? ' (dry-run)' : ''}`);

    const rulesById = new Map(reviewable.map(r => [r.id, { id: r.id, type: r.type }]));
    const results = applyJanitorActions(actions, rulesById, { dryRun: opts.dryRun });

    const report: JanitorReport = {
      timestamp: now,
      runtime,
      reviewed: reviewable.length,
      actions: results,
      dryRun: opts.dryRun ?? false,
    };
    try {
      fs.writeFileSync(path.join(hookStateDir(), REPORT_FILE), JSON.stringify(report, null, 2));
    } catch { /* report is best-effort */ }

    for (const r of results) {
      hookLog(HOOK_NAME, `${r.applied ? 'applied' : 'FAILED'} ${r.action} [${r.ids.join(',')}]: ${r.reason}`);
    }
    return report;
  } catch (err) {
    hookLog(HOOK_NAME, `worker error: ${safeErrorMessage(err)}`);
    return null;
  }
}

/** Read the last report for CLI display. Null if none exists. */
export function readLastJanitorReport(): JanitorReport | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(hookStateDir(), REPORT_FILE), 'utf-8'));
  } catch {
    return null;
  }
}
