/**
 * Kiro CLI hook adapters.
 *
 * Kiro CLI's hook contract (kiro.dev/docs/cli/hooks) is nearly identical to
 * Claude Code's: hooks receive JSON on stdin with hook_event_name, cwd,
 * session_id, tool_name, tool_input. These adapters bridge the three
 * differences:
 *
 *   1. Tool names are Kiro-internal (execute_bash, fs_write, fs_read) —
 *      mapped to the Claude Code names our handlers and the rule ranker
 *      understand. fs_write inputs use `path`, mapped to `file_path`.
 *   2. PostToolUse carries `tool_response` (an object), not a `tool_output`
 *      string.
 *   3. Hook stdout reaches the model's context ONLY on agentSpawn and
 *      userPromptSubmit (no hookSpecificOutput JSON envelope). preToolUse
 *      stdout is IGNORED — exit codes gate the tool call, and only exit-2
 *      stderr is shown to the LLM; postToolUse stdout is ignored too
 *      (kiro.dev/docs/cli/hooks, verified empirically 2026-07-13). So all
 *      context injection rides agentSpawn (rules up front at session start)
 *      and userPromptSubmit (periodic mid-session refresh, see
 *      emitRuleRefresh). Claude Code needs the search-enforcer dance for
 *      this; Kiro gets it for free.
 *
 * userPromptSubmit needs no adapter: Kiro sends { prompt, session_id, cwd },
 * exactly what correction-detector expects — wire it directly.
 *
 * Known v1 gaps (accepted): Kiro provides no tool_use_id, so rule-injection →
 * outcome correlation is weaker than under Claude Code; the stop event carries
 * only assistant_response (no transcript file), so transcript-based failure
 * detectors and session extraction don't run under Kiro.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { hookLog, safeErrorMessage, hookStateDir } from './shared';
import { LOAD_RULES_DIRECTIVE } from '../shared/directives';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { handleToolOutcomeWatcher } from './tool-outcome-watcher';
import { handleCorrectionDetector } from './correction-detector';
import { formatRuleValue, precisionNudge } from '../mcp/tools/memory-tools';

const HOOK_NAME = 'kiro';

/** Kiro built-in tool names → the Claude Code names our handlers understand. */
const KIRO_TOOL_NAME_MAP: Record<string, string> = {
  execute_bash: 'Bash',
  shell: 'Bash',
  fs_write: 'Write',
  fs_read: 'Read',
};

/**
 * Normalize a Kiro hook payload to the Claude Code shape. Pure and
 * non-destructive — returns a shallow copy; unknown tool names (use_aws,
 * @mcp-server tools, ...) pass through unchanged.
 */
export function normalizeKiroInput(input: any): any {
  if (!input || typeof input !== 'object') return input;

  const normalized: any = { ...input };

  if (typeof input.tool_name === 'string' && KIRO_TOOL_NAME_MAP[input.tool_name]) {
    normalized.tool_name = KIRO_TOOL_NAME_MAP[input.tool_name];
  }

  // Kiro file tools use `path`; our handlers key on `file_path`
  if (input.tool_input && typeof input.tool_input === 'object'
      && typeof input.tool_input.path === 'string' && input.tool_input.file_path === undefined) {
    normalized.tool_input = { ...input.tool_input, file_path: input.tool_input.path };
  }

  // PostToolUse: tool_response (object) → tool_output (string)
  if (input.tool_response !== undefined && input.tool_output === undefined) {
    normalized.tool_output = typeof input.tool_response === 'string'
      ? input.tool_response
      : JSON.stringify(input.tool_response);
  }

  return normalized;
}

/** Format active rules as markdown sections (mirrors the Pi extension). */
function formatRulesForContext(): { body: string; total: number } {
  const projectId = ConfigService.getInstance().getProjectId();
  const rules = MemoryService.getInstance().loadActiveRules(projectId);

  const section = (title: string, items: Array<{ value: any }>): string | null => {
    if (items.length === 0) return null;
    return `## ${title}\n` + items.map(m => `- ${formatRuleValue(m.value)}${precisionNudge(m.value)}`).join('\n');
  };

  const sections = [
    section('Preferences', rules.preferences),
    section('Corrections', rules.corrections),
    section('Solutions (hard-won — reuse these)', rules.solutions ?? []),
    section('Failures', rules.failures),
    section('DevOps Rules', rules.devops),
  ].filter((s): s is string => s !== null);

  const total = rules.preferences.length + rules.corrections.length
    + rules.failures.length + rules.devops.length + (rules.solutions ?? []).length;

  return { body: sections.join('\n\n'), total };
}

/**
 * Standing instruction so the agent KNOWS it has persistent memory — and,
 * critically, that capture happens via BACKGROUND HOOKS independent of the MCP
 * tools. Under enterprise Kiro governance the claude-recall MCP server is
 * dropped from the toolset, but the agentSpawn/userPromptSubmit/postToolUse
 * hooks still write to and read from the local DB. Without the "even without
 * the tools" clause the agent answers "I can't store that, I have no memory
 * tools" — technically true of the TOOL, but false of the system, since the
 * hook already captured it. This is the exact confusion observed in a
 * governance-locked session.
 */
const KIRO_MEMORY_DIRECTIVE =
  'You have PERSISTENT MEMORY across sessions via Claude Recall. Your preferences, corrections, and the ' +
  'rules shown below are captured AUTOMATICALLY by background hooks and injected into your context at the ' +
  'start of every session — this works even if the claude-recall MCP tools (store_memory, search_memory, …) ' +
  'are NOT in your current toolset (e.g. restricted by your organization\'s policy). ' +
  'So when the user says "remember …", "recall …", "store this", states a preference, or corrects you: ' +
  'if the store_memory tool is available, call it and say what you stored; if it is NOT available, simply ' +
  'confirm the point will be remembered — it is already being captured automatically by the hook. ' +
  'NEVER tell the user you have no memory between sessions or cannot persist anything. ' +
  'When the MCP tools ARE available, also use search_memory before decisions where past context may apply. ' +
  'Memories are scoped per project and shared with the user\'s other coding agents.';

/**
 * agentSpawn — runs once when a Kiro agent activates. Whatever we print is
 * added to the agent's context, so this IS the load_rules call: rules are in
 * context from turn one without any tool call or enforcement. The memory
 * directive is always emitted, even with an empty database — capability
 * awareness must not depend on having memories already.
 */
export async function handleKiroAgentSpawn(_input: any): Promise<void> {
  try {
    const parts: string[] = [KIRO_MEMORY_DIRECTIVE];
    let total = 0;

    try {
      const rules = formatRulesForContext();
      total = rules.total;
      if (rules.body) {
        parts.push(LOAD_RULES_DIRECTIVE, '---', rules.body);
      }
    } catch (err) {
      hookLog(HOOK_NAME, `agentSpawn rule load failed (directive still emitted): ${safeErrorMessage(err)}`);
    }

    // Surface a pending task checkpoint the same way load_rules hints at one
    try {
      const projectId = ConfigService.getInstance().getProjectId();
      const checkpoint = MemoryService.getInstance().loadCheckpoint(projectId);
      if (checkpoint) {
        parts.push(
          `📌 A task checkpoint exists for this project (updated ${new Date(checkpoint.updated_at).toLocaleString()}). ` +
          `Remaining: ${checkpoint.remaining.substring(0, 200)}`
        );
      }
    } catch { /* checkpoint hint is best-effort */ }

    process.stdout.write(parts.join('\n\n') + '\n');
    hookLog(HOOK_NAME, `agentSpawn: injected memory directive + ${total} rule(s) into Kiro context`);

    // Session start is also the janitor's trigger: at most one detached
    // hygiene pass per 24h, never blocking startup (returns in ms).
    try {
      const { maybeSpawnJanitor } = await import('./memory-janitor');
      maybeSpawnJanitor(_input, 'kiro');
    } catch (err) {
      hookLog(HOOK_NAME, `janitor spawn skipped: ${safeErrorMessage(err)}`);
    }
  } catch (err) {
    // Never block agent startup
    hookLog(HOOK_NAME, `agentSpawn error: ${safeErrorMessage(err)}`);
  }
}

/**
 * preToolUse — DEPRECATED no-op. This used to emit just-in-time rule
 * injections, on the assumption that Kiro adds preToolUse stdout to context.
 * It does not: preToolUse stdout is ignored — exit codes gate the tool call
 * and only exit-2 stderr reaches the LLM (kiro.dev/docs/cli/hooks, verified
 * empirically 2026-07-13) — so nothing this handler printed ever reached the
 * model, while every emission was falsely recorded as an injection. Mid-session
 * injection now rides userPromptSubmit (emitRuleRefresh). The handler stays
 * registered so agent configs wired by older versions keep exiting 0;
 * `kiro setup` no longer wires it and strips stale entries on re-run.
 */
export async function handleKiroRuleInjector(_input: any): Promise<void> {
  hookLog(HOOK_NAME, 'kiro-rule-injector is deprecated (Kiro ignores preToolUse stdout) — no-op; re-run `claude-recall kiro setup` to unwire it');
}

/**
 * postToolUse — outcome capture and Bash fix-pairing, delegated to the shared
 * tool-outcome-watcher after payload normalization.
 */
export async function handleKiroToolOutcome(input: any): Promise<void> {
  try {
    await handleToolOutcomeWatcher(normalizeKiroInput(input));
  } catch (err) {
    hookLog(HOOK_NAME, `tool-outcome error: ${safeErrorMessage(err)}`);
  }
}

/**
 * Mid-session rule refresh — the Kiro answer to long-session context loss.
 * Rules enter context once at agentSpawn; when Kiro later compacts or rolls
 * the conversation, they silently vanish and nothing re-injects them (Kiro has
 * no post-compaction event, and preToolUse stdout is ignored — see
 * handleKiroRuleInjector). userPromptSubmit stdout IS added to context
 * same-turn, so every CLAUDE_RECALL_REFRESH_INTERVAL prompts (default 15,
 * 0 disables) we re-emit the active rules from here.
 *
 * The prompt counter is per-session (keyed by session_id) in hook-state/;
 * stale counter files are pruned on each session's first prompt.
 */
const DEFAULT_REFRESH_INTERVAL = 15;
const REFRESH_STATE_PREFIX = 'kiro-refresh-';
const REFRESH_STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function refreshInterval(): number {
  const raw = process.env.CLAUDE_RECALL_REFRESH_INTERVAL;
  if (raw === undefined || raw.trim() === '') return DEFAULT_REFRESH_INTERVAL;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_REFRESH_INTERVAL;
  return n > 0 ? n : 0;
}

/** Increment the per-session prompt counter and return the new count. */
function bumpPromptCount(sessionId: string): number {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
  const file = path.join(hookStateDir(), `${REFRESH_STATE_PREFIX}${safeId}.json`);

  let count = 0;
  try {
    count = JSON.parse(fs.readFileSync(file, 'utf8')).count ?? 0;
  } catch { /* first prompt of the session, or unreadable — start fresh */ }

  count++;
  fs.writeFileSync(file, JSON.stringify({ count, updated: Date.now() }));
  if (count === 1) pruneStaleRefreshState();
  return count;
}

/** Best-effort removal of counter files from long-dead sessions. */
function pruneStaleRefreshState(): void {
  try {
    const dir = hookStateDir();
    const cutoff = Date.now() - REFRESH_STATE_MAX_AGE_MS;
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(REFRESH_STATE_PREFIX)) continue;
      const p = path.join(dir, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch { /* another process won the race — fine */ }
    }
  } catch { /* pruning is housekeeping, never let it interfere */ }
}

function emitRuleRefresh(input: any): void {
  try {
    const interval = refreshInterval();
    if (interval === 0) return;

    const count = bumpPromptCount(String(input?.session_id ?? 'default'));
    if (count % interval !== 0) return;

    const rules = formatRulesForContext();
    if (!rules.body) return;

    process.stdout.write(
      `🔄 Recall: periodic rule refresh (prompt ${count} this session). ` +
      'Earlier rule injections may have been compacted out of your context — continue applying these:\n\n' +
      rules.body + '\n',
    );
    hookLog(HOOK_NAME, `refresh: re-injected ${rules.total} rule(s) at prompt ${count} (interval ${interval})`);
  } catch (err) {
    // The refresh is an enhancement — never let it break capture
    hookLog(HOOK_NAME, `refresh error: ${safeErrorMessage(err)}`);
  }
}

/**
 * userPromptSubmit — the synchronous gate Kiro waits on. Under Kiro there is no
 * ANTHROPIC_API_KEY, so classification uses Kiro's own headless LLM
 * (`kiro-cli chat --no-interactive`), which cold-boots in ~3–15s — too slow to
 * run inline within Kiro's hook timeout, and a poor UX blocking every turn.
 *
 * So this handler does NOT classify. It spawns a DETACHED worker
 * (kiro-capture-worker) that survives this process, pipes the prompt payload to
 * it over stdin, and returns in milliseconds. The worker performs the slow Kiro
 * classify call and stores the memory in the background. Same pattern as
 * session-end-checkpoint. See docs/kiro-llm-capture.md.
 *
 * It also owns the mid-session rule refresh (emitRuleRefresh above): the
 * refresh must count EVERY prompt, so it runs before the capture pre-checks.
 */
export async function handleKiroCapture(input: any): Promise<void> {
  emitRuleRefresh(input);

  const prompt: string = input?.prompt ?? '';
  // Cheap pre-checks mirror correction-detector so we don't spawn a worker (and
  // spend Kiro credits) on input that could never be stored.
  if (prompt.length < 20 || prompt.length > 2000) return;
  if (prompt.startsWith('```') || prompt.startsWith('{')) return;

  try {
    const cliPath = process.argv[1]; // absolute path to claude-recall-cli.js
    const child = spawn(
      process.execPath,
      [cliPath, 'hook', 'run', 'kiro-capture-worker'],
      { detached: true, stdio: ['pipe', 'ignore', 'ignore'] },
    );

    child.on('error', (err) => {
      hookLog(HOOK_NAME, `capture worker spawn error: ${err?.message ?? err}`);
    });

    if (child.stdin) {
      child.stdin.on('error', (err) => {
        hookLog(HOOK_NAME, `capture worker stdin error: ${err?.message ?? err}`);
      });
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    }

    child.unref();
    hookLog(HOOK_NAME, `capture: spawned detached worker (pid=${child.pid})`);
  } catch (err) {
    hookLog(HOOK_NAME, `capture spawn failed: ${safeErrorMessage(err)}`);
  }
}

/**
 * kiro-capture-worker — the background half of handleKiroCapture. Enables the
 * Kiro-LLM classifier path (CLAUDE_RECALL_KIRO_CLASSIFIER) and delegates to the
 * standard correction-detector, which now classifies via Kiro's headless LLM
 * and stores. Runs detached, so its output goes nowhere and capture is silent.
 */
export async function handleKiroCaptureWorker(input: any): Promise<void> {
  process.env.CLAUDE_RECALL_KIRO_CLASSIFIER = '1';
  try {
    await handleCorrectionDetector(input);
  } catch (err) {
    hookLog(HOOK_NAME, `capture worker error: ${safeErrorMessage(err)}`);
  }
}
