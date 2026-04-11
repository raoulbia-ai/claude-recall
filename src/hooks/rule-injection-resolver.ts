/**
 * rule-injection-resolver hook — fires on PostToolUse and PostToolUseFailure.
 *
 * Counterpart to rule-injector.ts. After a tool call completes (successfully
 * or with failure), this hook resolves any rule_injection_events that were
 * recorded for that tool_use_id with the actual outcome.
 *
 * The pair gives us a direct measurement of rule effectiveness:
 *   - Rule X was injected before Bash call Y
 *   - Bash call Y succeeded → rule X co-occurs with success
 *   - Bash call Y failed → rule X was either ignored, wrong, or unrelated
 *
 * Aggregated over time, this becomes the new "is this rule helpful" signal,
 * replacing the broken citation-detection regex (.research/rule-loading-gap.md).
 *
 * Always exits cleanly with no stdout — this hook only writes to the DB,
 * it doesn't influence tool execution.
 */

import { hookLog } from './shared';
import { OutcomeStorage } from '../services/outcome-storage';

export async function handleRuleInjectionResolver(input: any): Promise<void> {
  const toolUseId: string = input?.tool_use_id ?? '';
  const eventName: string = input?.hook_event_name ?? '';

  if (!toolUseId) {
    return;
  }

  // Outcome inference: PostToolUseFailure means failure, anything else means success.
  // (PostToolUse fires on success; PostToolUseFailure on tool errors.)
  const outcome: 'success' | 'failure' = eventName === 'PostToolUseFailure' ? 'failure' : 'success';

  try {
    const outcomeStorage = OutcomeStorage.getInstance();
    const resolved = outcomeStorage.resolveRuleInjections(toolUseId, outcome);
    if (resolved > 0) {
      hookLog(
        'rule-injection-resolver',
        `Resolved ${resolved} rule injection(s) for ${toolUseId} as ${outcome}`,
      );
    }
  } catch (err) {
    hookLog('rule-injection-resolver', `Error: ${(err as Error).message}`);
  }
}
