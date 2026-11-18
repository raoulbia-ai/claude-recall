/**
 * Whether to write outcome rows (`outcome_events`, `rule_injection_events`,
 * `episodes`).
 *
 * Since the lesson step was retired (0.50.0), nothing but the `outcomes` CLI
 * reads these rows, so they are written only when the user asks for that
 * history: `CLAUDE_RECALL_OUTCOME_TRACKING=on`. The default (`auto`) and `off`
 * write nothing. Failure memories are unaffected; they are stored directly.
 */
export function shouldRecordOutcomes(): boolean {
  switch ((process.env.CLAUDE_RECALL_OUTCOME_TRACKING || 'auto').toLowerCase()) {
    case 'on':
    case 'true':
    case '1':
      return true;
    default:
      return false;
  }
}
