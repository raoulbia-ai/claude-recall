import { shouldRecordOutcomes } from '../../src/shared/outcome-capture';

/**
 * Outcome rows are history for the `outcomes` CLI and nothing else since the
 * lesson step was retired, so they are written only when tracking is on.
 */
describe('shouldRecordOutcomes', () => {
  const prev = process.env.CLAUDE_RECALL_OUTCOME_TRACKING;

  afterEach(() => {
    if (prev === undefined) delete process.env.CLAUDE_RECALL_OUTCOME_TRACKING;
    else process.env.CLAUDE_RECALL_OUTCOME_TRACKING = prev;
  });

  it('records nothing by default', () => {
    delete process.env.CLAUDE_RECALL_OUTCOME_TRACKING;
    expect(shouldRecordOutcomes()).toBe(false);
  });

  it('records when forced on', () => {
    for (const value of ['on', 'true', '1', 'ON']) {
      process.env.CLAUDE_RECALL_OUTCOME_TRACKING = value;
      expect(shouldRecordOutcomes()).toBe(true);
    }
  });

  it('records nothing for off, auto or an unknown value', () => {
    for (const value of ['off', 'false', '0', 'auto', 'maybe']) {
      process.env.CLAUDE_RECALL_OUTCOME_TRACKING = value;
      expect(shouldRecordOutcomes()).toBe(false);
    }
  });
});
