import { shouldRecordOutcomes } from '../../src/shared/outcome-capture';

/**
 * Collection follows the consumer.
 *
 * Raw outcome telemetry exists to feed `memory-stop-hook`, which distills it
 * into candidate lessons and citation counts. That hook is wired into Claude
 * Code's hook CLI only, so on Pi the rows were written and never read — one
 * host reached 246845 `outcome_events` rows with `candidate_lessons` still
 * empty.
 */
describe('shouldRecordOutcomes', () => {
  const prev = process.env.CLAUDE_RECALL_OUTCOME_TRACKING;

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_RECALL_OUTCOME_TRACKING;
    else process.env.CLAUDE_RECALL_OUTCOME_TRACKING = prev;
  });

  function withTracking(value: string | undefined): void {
    if (value === undefined) delete process.env.CLAUDE_RECALL_OUTCOME_TRACKING;
    else process.env.CLAUDE_RECALL_OUTCOME_TRACKING = value;
  }

  it('collects under Claude Code by default — the distillation step runs there', () => {
    withTracking(undefined);
    expect(shouldRecordOutcomes('cc')).toBe(true);
  });

  it('does not collect under Pi by default — nothing reads the rows back', () => {
    withTracking(undefined);
    expect(shouldRecordOutcomes('pi')).toBe(false);
  });

  it('collects on every runtime when forced on', () => {
    for (const value of ['on', 'true', '1', 'ON']) {
      withTracking(value);
      expect(shouldRecordOutcomes('pi')).toBe(true);
      expect(shouldRecordOutcomes('cc')).toBe(true);
    }
  });

  it('collects on no runtime when forced off', () => {
    for (const value of ['off', 'false', '0', 'Off']) {
      withTracking(value);
      expect(shouldRecordOutcomes('pi')).toBe(false);
      expect(shouldRecordOutcomes('cc')).toBe(false);
    }
  });

  it('falls back to the per-runtime default on an unrecognized value', () => {
    withTracking('maybe');
    expect(shouldRecordOutcomes('cc')).toBe(true);
    expect(shouldRecordOutcomes('pi')).toBe(false);
  });

  it('is read per call, so a mid-session change takes effect', () => {
    withTracking('off');
    expect(shouldRecordOutcomes('cc')).toBe(false);
    withTracking('on');
    expect(shouldRecordOutcomes('cc')).toBe(true);
  });
});
