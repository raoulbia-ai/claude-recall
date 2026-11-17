const mockDetect = jest.fn();
const mockCreateLesson = jest.fn();
const mockFindSimilar = jest.fn().mockReturnValue([]);
const mockIncrementEvidence = jest.fn();
const mockHint = jest.fn().mockResolvedValue(null);

jest.mock('../../src/services/memory', () => ({
  MemoryService: { getInstance: () => ({ store: jest.fn() }) },
}));
jest.mock('../../src/services/config', () => ({
  ConfigService: { getInstance: () => ({ getProjectId: () => 'proj' }) },
}));
jest.mock('../../src/services/outcome-storage', () => ({
  OutcomeStorage: {
    getInstance: () => ({
      createCandidateLesson: mockCreateLesson,
      findSimilarLessons: mockFindSimilar,
      incrementEvidenceCount: mockIncrementEvidence,
    }),
  },
}));
jest.mock('../../src/hooks/llm-classifier', () => ({ extractHindsightHint: mockHint }));
jest.mock('../../src/hooks/failure-detectors', () => ({ detectFailures: mockDetect, detectTranscriptFailures: jest.fn() }));

import { distilFailures } from '../../src/shared/session-distillation';
import { generateCandidateLessons } from '../../src/hooks/memory-stop-hook';

/** The remedy every detector emits until a fix has been paired with the failure. */
const DEFAULT_REMEDY = 'Check command syntax, file paths, and prerequisites before running';

const failure = (what: string, opts: { remedy?: string; confidence?: number } = {}) => ({
  signal: 'non-zero-exit',
  confidence: opts.confidence ?? 0.9,
  content: {
    what_failed: what,
    why_failed: 'Exit code 1',
    what_should_do: opts.remedy ?? 'run terraform init first',
    context: 'running the plan',
  },
});

/** A session that made tool calls; what they were is the detectors' business. */
const session = [{ call: { id: 't1', name: 'bash', input: {}, entryIndex: 0 } }] as any;
const distil = (extra: { stopAt?: number } = {}) =>
  distilFailures({ interactions: session, projectId: 'proj', episodeId: 'ep1', ...extra });

beforeEach(() => {
  jest.clearAllMocks();
  mockFindSimilar.mockReturnValue([]);
  mockHint.mockResolvedValue(null);
});

/**
 * Pi holds its tool calls in memory and has no transcript file. Its failures
 * were captured and never distilled: candidate_lessons stayed empty while the
 * failure memories piled up.
 */
describe('distilFailures', () => {
  it('files a lesson under the session\'s own episode, in the model\'s words', async () => {
    mockDetect.mockReturnValue([failure('Command failed: terraform plan')]);
    mockHint.mockResolvedValue({ hint_text: 'run terraform init before plan', hint_kind: 'rule', applies_when: ['terraform'] });

    await distil();

    expect(mockDetect).toHaveBeenCalledWith(session);
    expect(mockCreateLesson).toHaveBeenCalledTimes(1);
    expect(mockCreateLesson.mock.calls[0][0]).toMatchObject({
      project_id: 'proj',
      episode_id: 'ep1',
      lesson_text: 'run terraform init before plan',
      lesson_kind: 'rule',
      applies_when: ['terraform'],
    });
  });

  it('records no lesson that would only restate the failure', async () => {
    // No hindsight, and the remedy is the detector's default: promoted, this
    // would be a rule loaded every turn that says what the failure memory
    // already says.
    mockDetect.mockReturnValue([failure('Command failed: terraform plan', { remedy: DEFAULT_REMEDY })]);

    await distil();

    expect(mockCreateLesson).not.toHaveBeenCalled();
    expect(mockIncrementEvidence).not.toHaveBeenCalled();
  });

  it('keeps the lesson when the model had hindsight to give, default remedy or not', async () => {
    mockDetect.mockReturnValue([failure('Command failed: terraform plan', { remedy: DEFAULT_REMEDY })]);
    mockHint.mockResolvedValue({ hint_text: 'run terraform init before plan', hint_kind: 'failure_preventer', applies_when: [] });

    await distil();

    expect(mockCreateLesson.mock.calls[0][0]).toMatchObject({ lesson_text: 'run terraform init before plan' });
  });

  it('keeps a lesson whose remedy a paired fix has already made specific', async () => {
    mockDetect.mockReturnValue([failure('Command failed: terraform plan')]);

    await distil();

    expect(mockCreateLesson).toHaveBeenCalledTimes(1);
    expect(mockCreateLesson.mock.calls[0][0].lesson_text).toContain('run terraform init first');
  });

  it('counts evidence instead of duplicating a lesson already on record', async () => {
    mockDetect.mockReturnValue([failure('Command failed: terraform plan')]);
    mockFindSimilar.mockReturnValue([{ id: 'lesson-1' }]);

    await distil();

    expect(mockIncrementEvidence).toHaveBeenCalledWith('lesson-1');
    expect(mockCreateLesson).not.toHaveBeenCalled();
  });

  it('ignores low-confidence detections', async () => {
    mockDetect.mockReturnValue([failure('maybe something broke', { confidence: 0.3 })]);

    await distil();

    expect(mockHint).not.toHaveBeenCalled();
    expect(mockCreateLesson).not.toHaveBeenCalled();
  });

  it('does nothing when the detectors find nothing', async () => {
    mockDetect.mockReturnValue([]);

    await distil();

    expect(mockHint).not.toHaveBeenCalled();
  });

  it('swallows a detector failure rather than breaking session end', async () => {
    mockDetect.mockImplementation(() => { throw new Error('boom'); });

    await expect(distil()).resolves.toBeUndefined();
  });

  describe('running out of time', () => {
    afterEach(() => jest.useRealTimers());

    it('takes up no further failure, and keeps the answer already on its way', async () => {
      // Work that carries on behind the deadline keeps the process alive and
      // keeps paying for model calls.
      jest.useFakeTimers();
      let answerFirst: (hint: null) => void = () => {};
      mockHint.mockImplementationOnce(() => new Promise(resolve => { answerFirst = resolve; }));
      mockDetect.mockReturnValue(['a', 'b', 'c'].map(name => failure(`Command failed: ${name}`)));

      const done = distil({ stopAt: Date.now() + 1000 });
      await jest.advanceTimersByTimeAsync(1000);
      answerFirst(null);
      await done;

      expect(mockHint).toHaveBeenCalledTimes(1);
      expect(mockCreateLesson).toHaveBeenCalledTimes(1);
    });

    it('asks nothing at all when its time was spent before it began', async () => {
      // The stop is a point in time, not a duration: whatever ran before this
      // in the session's end has already used the clock.
      mockDetect.mockReturnValue([failure('Command failed: terraform plan')]);

      await distil({ stopAt: Date.now() - 1 });

      expect(mockHint).not.toHaveBeenCalled();
      expect(mockCreateLesson).not.toHaveBeenCalled();
    });
  });
});

/**
 * The lesson writer is the Stop hook's own, lent to Pi with two options. With
 * neither given it must do what it has always done for Claude Code.
 */
describe('generateCandidateLessons, as Claude Code calls it', () => {
  it('still records the grounded lesson when there is no hindsight', async () => {
    await generateCandidateLessons(
      [failure('Command failed: terraform plan', { remedy: DEFAULT_REMEDY }) as any], 'ep1', 'proj',
    );

    expect(mockCreateLesson).toHaveBeenCalledTimes(1);
    expect(mockCreateLesson.mock.calls[0][0].lesson_text)
      .toBe(`${DEFAULT_REMEDY} (failure: Command failed: terraform plan)`);
  });

  it('works through every failure when no one tells it to stop', async () => {
    await generateCandidateLessons(
      ['a', 'b', 'c'].map(name => failure(`Command failed: ${name}`) as any), 'ep1', 'proj',
    );

    expect(mockHint).toHaveBeenCalledTimes(3);
    expect(mockCreateLesson).toHaveBeenCalledTimes(3);
  });
});
