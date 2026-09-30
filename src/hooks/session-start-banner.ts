/**
 * session-start-banner hook — fires on SessionStart (normal sources).
 *
 * A MODEL-FACING primer. Claude Code treats SessionStart hook stdout as context
 * for the model, NOT a user-visible message (verified against the hooks docs) —
 * the user-visible "memory active" indicator is the `claude-recall statusline`
 * command instead. This line still earns its place: it primes the model at
 * session start that persistent memory is on and capture is automatic, which
 * matters most under governance where the MCP tools are absent (so the model
 * never claims it has no memory).
 *
 * It does NOT re-inject full rule bodies (the rule-injector does that
 * just-in-time before each tool call) — keeping the per-session context cost to
 * a single line. The compaction case is left to post-compact-reload (which
 * re-injects the rules that were dropped), so this handler no-ops on
 * source "compact" to avoid a duplicate.
 *
 * Input: { session_id, hook_event_name: "SessionStart", source: "startup" | "resume" | "clear" | "compact" }
 */

import { hookLog } from './shared';
import { MemoryService } from '../services/memory';
import { ConfigService } from '../services/config';

export async function handleSessionStartBanner(input: any): Promise<void> {
  try {
    // post-compact-reload owns the compaction case (full re-injection).
    if (input?.source === 'compact') return;

    const projectId = ConfigService.getInstance().getProjectId();
    const rules = MemoryService.getInstance().loadActiveRules(projectId);
    const total =
      rules.preferences.length + rules.corrections.length + rules.failures.length +
      rules.devops.length + (rules.solutions ?? []).length;

    if (total > 0) {
      console.log(
        `🧠 Recall: memory active — ${total} rule${total === 1 ? '' : 's'} for "${projectId}". ` +
        `Preferences and corrections you state are captured automatically.`
      );
    } else {
      console.log(
        `🧠 Recall: memory active for "${projectId}" — no rules yet. ` +
        `State a preference or correction and it's captured automatically.`
      );
    }

    hookLog('session-start-banner', `shown (${total} rules, source=${input?.source ?? 'unknown'})`);
  } catch (err) {
    // Never block session start; a broken DB just means no banner (doctor flags it).
    hookLog('session-start-banner', `Error: ${(err as Error).message}`);
  }
}
