/**
 * Whether raw outcome telemetry is worth collecting on this runtime.
 *
 * `outcome_events` and `rule_injection_events` exist to feed `memory-stop-hook`,
 * which is wired into Claude Code's hook CLI only. Elsewhere the rows are
 * written and never read — on one Pi-only host, two thirds of the database.
 *
 * `CLAUDE_RECALL_OUTCOME_TRACKING=on` collects anyway (the `outcomes` CLI reads
 * these tables), `off` collects nowhere.
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
