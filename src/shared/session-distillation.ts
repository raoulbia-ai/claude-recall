/**
 * Distil a session's failures into candidate lessons, for a runtime that holds
 * its tool calls in memory instead of a transcript file.
 *
 * Claude Code's Stop hook has always done this from its transcript. On a Pi
 * host failures were captured and never distilled: `candidate_lessons` stayed
 * empty while the failure memories piled up. The detectors and the lesson
 * writer are the Stop hook's own — nothing about them needed a transcript.
 */

import { detectFailures, DetectedFailure } from '../hooks/failure-detectors';
import { generateCandidateLessons } from '../hooks/memory-stop-hook';
import type { ToolInteraction } from '../hooks/shared';
import { hookLog, safeErrorMessage } from '../hooks/shared';

const LOG_TAG = 'session-distillation';

/**
 * Record candidate lessons for the failures in `interactions`, under the
 * episode the session already opened. Promotion is the caller's next step.
 * Never throws.
 *
 * Nothing is stored as a failure memory here: a runtime that holds its tool
 * calls has captured each failure as it happened.
 */
export async function distilFailures(input: {
  interactions: ToolInteraction[];
  projectId: string;
  episodeId: string;
  /**
   * When to stop, as a point in time (epoch ms), so that it means the same
   * thing however late distillation got to start. Past it no further failure
   * is taken up; a model call already in flight is left to finish.
   */
  stopAt?: number;
}): Promise<void> {
  let failures: DetectedFailure[];
  try {
    failures = detectFailures(input.interactions);
  } catch (err) {
    hookLog(LOG_TAG, `Failure detection error: ${safeErrorMessage(err)}`);
    return;
  }
  if (failures.length === 0) return;

  // Out of time before starting: whatever ran earlier in the session's end
  // has used the clock, and nothing is asked.
  const left = input.stopAt === undefined ? undefined : input.stopAt - Date.now();
  if (left !== undefined && left <= 0) return;

  const stop = new AbortController();
  const timer = left === undefined ? undefined : setTimeout(() => {
    hookLog(LOG_TAG, 'out of time — no further failure is taken up');
    stop.abort();
  }, left);
  try {
    await generateCandidateLessons(failures, input.episodeId, input.projectId, {
      stop: stop.signal,
      // Without a model there is often nothing here but the detector's default
      // remedy, and on a Pi host that is the usual case, not the exception.
      skipBoilerplate: true,
    });
  } finally {
    clearTimeout(timer);
  }
}
