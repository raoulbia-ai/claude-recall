import { MemoryService } from '../../src/services/memory';
import { OutcomeStorage } from '../../src/services/outcome-storage';

const mockDetect = jest.fn();
const mockHint = jest.fn().mockResolvedValue(null);

// The store is the real one, in memory: what counts as "the same lesson" is
// its decision, and a stand-in would only repeat this file's own assumptions.
jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getDatabasePath: () => ':memory:',
      getProjectId: () => 'proj',
      getConfig: () => ({
        database: { compaction: { maxMemories: 10000 } },
        project: { rootDir: '/tmp' },
        citations: {},
      }),
    }),
  },
}));
jest.mock('../../src/services/logging', () => ({
  LoggingService: {
    getInstance: () => ({
      info: jest.fn(), debug: jest.fn(), error: jest.fn(),
      logMemoryOperation: jest.fn(), logRetrieval: jest.fn(), logServiceError: jest.fn(),
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

/** Every lesson on record, oldest first. */
const lessons = () => OutcomeStorage.getInstance().getCandidateLessons('proj');

beforeEach(() => {
  jest.clearAllMocks();
  mockHint.mockResolvedValue(null);
  (MemoryService as any).instance = undefined;
  OutcomeStorage.resetInstance();
});

afterEach(() => {
  try { MemoryService.getInstance().close(); } catch { /* already closed */ }
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
    expect(lessons()).toEqual([expect.objectContaining({
      project_id: 'proj',
      episode_id: 'ep1',
      lesson_text: 'run terraform init before plan',
      lesson_kind: 'rule',
      applies_when_json: '["terraform"]',
      evidence_count: 1,
    })]);
  });

  it('records no lesson that would only restate the failure', async () => {
    // No hindsight, and the remedy is the detector's default: promoted, this
    // would be a rule loaded every turn that says what the failure memory
    // already says.
    mockDetect.mockReturnValue([failure('Command failed: terraform plan', { remedy: DEFAULT_REMEDY })]);

    await distil();

    expect(lessons()).toEqual([]);
  });

  it('keeps the lesson when the model had hindsight to give, default remedy or not', async () => {
    mockDetect.mockReturnValue([failure('Command failed: terraform plan', { remedy: DEFAULT_REMEDY })]);
    mockHint.mockResolvedValue({ hint_text: 'run terraform init before plan', hint_kind: 'failure_preventer', applies_when: [] });

    await distil();

    expect(lessons().map(l => l.lesson_text)).toEqual(['run terraform init before plan']);
  });

  it('keeps a lesson whose remedy a paired fix has already made specific', async () => {
    mockDetect.mockReturnValue([failure('Command failed: terraform plan')]);

    await distil();

    expect(lessons()).toHaveLength(1);
    expect(lessons()[0].lesson_text).toContain('run terraform init first');
  });

  it('counts a failure seen again as evidence for its lesson, not as a second lesson', async () => {
    mockDetect.mockReturnValue([failure('Command failed: terraform plan')]);
    mockHint.mockResolvedValue({ hint_text: 'run terraform init before plan', hint_kind: 'rule', applies_when: [] });

    await distil();
    await distil();

    expect(lessons().map(l => l.evidence_count)).toEqual([2]);
  });

  it('ignores low-confidence detections', async () => {
    mockDetect.mockReturnValue([failure('maybe something broke', { confidence: 0.3 })]);

    await distil();

    expect(mockHint).not.toHaveBeenCalled();
    expect(lessons()).toEqual([]);
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
      expect(lessons()).toHaveLength(1);
    });

    it('asks nothing at all when its time was spent before it began', async () => {
      // The stop is a point in time, not a duration: whatever ran before this
      // in the session's end has already used the clock.
      mockDetect.mockReturnValue([failure('Command failed: terraform plan')]);

      await distil({ stopAt: Date.now() - 1 });

      expect(mockHint).not.toHaveBeenCalled();
      expect(lessons()).toEqual([]);
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

    expect(lessons().map(l => l.lesson_text))
      .toEqual([`${DEFAULT_REMEDY} (failure: Command failed: terraform plan)`]);
  });

  it('works through every failure when no one tells it to stop', async () => {
    await generateCandidateLessons(
      ['a', 'b', 'c'].map(name => failure(`Command failed: ${name}`) as any), 'ep1', 'proj',
    );

    // All three were asked about and all three were counted — as lessons of
    // their own or as evidence for one another, which is the store's call.
    expect(mockHint).toHaveBeenCalledTimes(3);
    expect(lessons().reduce((seen, l) => seen + l.evidence_count, 0)).toBe(3);
  });
});
