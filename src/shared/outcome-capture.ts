/**
 * Whether raw outcome telemetry is worth collecting on this runtime.
 *
 * `outcome_events` and `rule_injection_events` are append-only observations —
 * one row per tool result — written so that the distillation step can later
 * turn them into `candidate_lessons` and citation counts. That step is
 * `memory-stop-hook`, wired only into Claude Code's hook CLI.
 *
 * On a runtime without it the rows are written and never read, which is not
 * free: on one Pi-only host `outcome_events` reached 246845 rows and about two
 * thirds of a 133MB database, and `candidate_lessons` was still empty.
 *
 * So collection follows the consumer. `CLAUDE_RECALL_OUTCOME_TRACKING=on`
 * forces collection anyway (the `outcomes` CLI reads these tables, and raw
 * events are useful when debugging capture), `off` disables it everywhere.
 */
export type Runtime = 'pi' | 'cc';

/** Runtimes that actually run the distillation step over raw events. */
const RUNTIMES_WITH_CONSUMER: ReadonlySet<Runtime> = new Set<Runtime>(['cc']);

export function shouldRecordOutcomes(runtime: Runtime): boolean {
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
      return RUNTIMES_WITH_CONSUMER.has(runtime);
  }
}
