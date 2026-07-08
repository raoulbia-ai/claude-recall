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
 *   3. Hook stdout is added directly to the agent's context — no
 *      hookSpecificOutput JSON envelope — and the agentSpawn event gives a
 *      context slot at session start, which we use to load active rules
 *      up front (Claude Code needs the search-enforcer dance for this;
 *      Kiro gets it for free).
 *
 * userPromptSubmit needs no adapter: Kiro sends { prompt, session_id, cwd },
 * exactly what correction-detector expects — wire it directly.
 *
 * Known v1 gaps (accepted): Kiro provides no tool_use_id, so rule-injection →
 * outcome correlation is weaker than under Claude Code; the stop event carries
 * only assistant_response (no transcript file), so transcript-based failure
 * detectors and session extraction don't run under Kiro.
 */

import { hookLog, safeErrorMessage } from './shared';
import { LOAD_RULES_DIRECTIVE } from '../shared/directives';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';
import { computeInjection } from './rule-injector';
import { handleToolOutcomeWatcher } from './tool-outcome-watcher';
import { formatRuleValue } from '../mcp/tools/memory-tools';

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
    return `## ${title}\n` + items.map(m => `- ${formatRuleValue(m.value)}`).join('\n');
  };

  const sections = [
    section('Preferences', rules.preferences),
    section('Corrections', rules.corrections),
    section('Failures', rules.failures),
    section('DevOps Rules', rules.devops),
  ].filter((s): s is string => s !== null);

  const total = rules.preferences.length + rules.corrections.length
    + rules.failures.length + rules.devops.length;

  return { body: sections.join('\n\n'), total };
}

/**
 * Standing instruction so the agent KNOWS it has persistent memory. Without
 * this, a session with no stored rules yet answers "I have no memory between
 * conversations" and never calls store_memory when the user says
 * "remember ..." — the exact failure observed on first use.
 */
const KIRO_MEMORY_DIRECTIVE =
  'You have PERSISTENT MEMORY across sessions via Claude Recall (MCP server "claude-recall": ' +
  'load_rules, store_memory, search_memory, delete_memory, save_checkpoint, load_checkpoint). ' +
  'When the user says "remember ...", "store this", "recall ...", states a preference, or corrects you, ' +
  'call store_memory (tell them what you will store). Use search_memory before decisions when past ' +
  'context might apply. Memories are scoped per project and shared with the user\'s other coding agents.';

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
  } catch (err) {
    // Never block agent startup
    hookLog(HOOK_NAME, `agentSpawn error: ${safeErrorMessage(err)}`);
  }
}

/**
 * preToolUse — just-in-time rule injection. Same ranking/recording core as
 * the Claude Code rule-injector, but emits plain text: Kiro adds hook stdout
 * to context directly (no hookSpecificOutput envelope).
 */
export async function handleKiroRuleInjector(input: any): Promise<void> {
  try {
    const normalized = normalizeKiroInput(input);
    const context = await computeInjection(
      normalized?.tool_name ?? '',
      normalized?.tool_input ?? {},
      '', // Kiro provides no tool_use_id
    );
    if (context) {
      process.stdout.write(context + '\n');
    }
  } catch (err) {
    // Best-effort — never block the tool call
    hookLog(HOOK_NAME, `rule-injector error: ${safeErrorMessage(err)}`);
  }
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
