/**
 * session-start-banner hook — fires on SessionStart (normal sources).
 *
 * Affordance, not injection. claude-recall runs almost entirely through
 * background hooks, so a user has little visible sign it's on — previously the
 * only feedback was around compaction (post-compact-reload). This prints one
 * concise, user-visible line at the start of every session confirming memory is
 * active, how many rules apply to this project, and that capture is automatic.
 *
 * It does NOT re-inject full rule bodies (the rule-injector does that
 * just-in-time before each tool call) — keeping the per-session context cost to
 * a single line. The compaction case is left to post-compact-reload (which
 * re-injects the rules that were dropped), so this handler no-ops on
 * source "compact" to avoid a duplicate banner.
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
