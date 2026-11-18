/**
 * Whether an outcome row is worth writing.
 *
 * Exactly one kind of row is read by logic: a `tool_failure` event, which the
 * Claude Code Stop hook turns into candidate lessons. Everything else written
 * to `outcome_events` or `rule_injection_events` (successful tool results,
 * sub-agent results, agent failures, re-ask signals, rule injections) is read
 * by nothing but the `outcomes` CLI. On one install that was 96% of the rows,
 * written from hooks that run on every tool call.
 *
 * - `auto` (default): lesson input only, and only where the lesson step runs.
 * - `on`: everything, everywhere — for the `outcomes` history and debugging.
 * - `off`: nothing. This also stops new lessons on Claude Code.
 */
export type Runtime = 'pi' | 'cc';

/**
 * `lesson-input`: rows the lesson step reads (tool failures).
 * `detail`: rows only the `outcomes` CLI shows.
 */
export type OutcomeKind = 'lesson-input' | 'detail';

/** Runtimes that actually run the lesson step over raw events. */
const RUNTIMES_WITH_CONSUMER: ReadonlySet<Runtime> = new Set<Runtime>(['cc']);

export function shouldRecordOutcomes(runtime: Runtime, kind: OutcomeKind): boolean {
  switch ((process.env.CLAUDE_RECALL_OUTCOME_TRACKING || 'auto').toLowerCase()) {
    case 'on':
    case 'true':
    case '1':
      return true;
    case 'off':
    case 'false':
    case '0':
      return false;
    default:
      return kind === 'lesson-input' && RUNTIMES_WITH_CONSUMER.has(runtime);
  }
}
