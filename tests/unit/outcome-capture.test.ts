import { shouldRecordOutcomes } from '../../src/shared/outcome-capture';

/**
 * Write only what something reads.
 *
 * The one row kind logic reads is a tool failure, which the Claude Code Stop
 * hook turns into candidate lessons. Everything else (tool results, sub-agent
 * results, re-ask signals, rule injections) is shown by the `outcomes` CLI and
 * read by nothing else, so it is written only when tracking is forced on.
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

  it('by default, records lesson input under Claude Code — the lesson step runs there', () => {
    withTracking(undefined);
    expect(shouldRecordOutcomes('cc', 'lesson-input')).toBe(true);
  });

  it('by default, records no detail rows anywhere — nothing but the outcomes CLI reads them', () => {
    withTracking(undefined);
    expect(shouldRecordOutcomes('cc', 'detail')).toBe(false);
    expect(shouldRecordOutcomes('pi', 'detail')).toBe(false);
  });

  it('by default, records nothing under Pi — it has no lesson step over these rows', () => {
    withTracking(undefined);
    expect(shouldRecordOutcomes('pi', 'lesson-input')).toBe(false);
  });

  it('records every kind on every runtime when forced on', () => {
    for (const value of ['on', 'true', '1', 'ON']) {
      withTracking(value);
      for (const runtime of ['cc', 'pi'] as const) {
        expect(shouldRecordOutcomes(runtime, 'lesson-input')).toBe(true);
        expect(shouldRecordOutcomes(runtime, 'detail')).toBe(true);
      }
    }
  });

  it('records nothing when forced off — lesson input included', () => {
    for (const value of ['off', 'false', '0', 'Off']) {
      withTracking(value);
      for (const runtime of ['cc', 'pi'] as const) {
        expect(shouldRecordOutcomes(runtime, 'lesson-input')).toBe(false);
        expect(shouldRecordOutcomes(runtime, 'detail')).toBe(false);
      }
    }
  });

  it('treats an unrecognized value as auto', () => {
    withTracking('maybe');
    expect(shouldRecordOutcomes('cc', 'lesson-input')).toBe(true);
    expect(shouldRecordOutcomes('cc', 'detail')).toBe(false);
  });
});
