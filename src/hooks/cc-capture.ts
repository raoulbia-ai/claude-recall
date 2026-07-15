/**
 * Claude Code capture — detached-worker pattern for UserPromptSubmit.
 *
 * Classification under Claude Code now prefers the user's SUBSCRIPTION (via
 * headless `claude -p`, see cc-classifier.ts) over an ANTHROPIC_API_KEY. That
 * call is ~4s cold — too slow to run inline while Claude Code blocks the
 * user's prompt on the hook. So the registered hook (`hook run
 * correction-detector`, unchanged in settings.json) spawns a DETACHED worker,
 * pipes the payload to it over stdin, and returns in milliseconds — the same
 * pattern as Kiro's kiro-capture (kiro-hooks.ts) and session-end-checkpoint.
 *
 * Trade-off: the synchronous "📌 Recall: auto-captured …" echo is gone —
 * capture is silent and lands ~4s later. Verify via
 * ~/.claude-recall/hook-logs/cc-classifier.log or `claude-recall search`.
 */

import { spawn } from 'child_process';
import { hookLog, safeErrorMessage } from './shared';
import { handleCorrectionDetector } from './correction-detector';

const HOOK_NAME = 'cc-capture';

/**
 * The inline half — fires on UserPromptSubmit, spawns the worker, returns
 * immediately. Pre-checks mirror correction-detector so we don't spawn a
 * process (or spend subscription usage) on input that could never be stored.
 */
export async function handleCcCapture(input: any): Promise<void> {
  // Recursion guard: if we're already inside a classifier's nested headless
  // session (claude -p or kiro-cli fired hooks of its own), do NOT spawn
  // another worker — that would classify the classify prompt, forever.
  if (
    process.env.CLAUDE_RECALL_NESTED
    || process.env.CLAUDE_RECALL_CC_CLASSIFIER
    || process.env.CLAUDE_RECALL_KIRO_CLASSIFIER
  ) {
    return;
  }

  // Janitor trigger rides on the first eligible prompt of the day — BEFORE
  // the length pre-checks, since hygiene doesn't care whether this particular
  // prompt is storable. Rate-limited internally (one run per 24h), detached.
  try {
    const { maybeSpawnJanitor } = await import('./memory-janitor');
    maybeSpawnJanitor(input, 'cc');
  } catch (err) {
    hookLog(HOOK_NAME, `janitor spawn skipped: ${safeErrorMessage(err)}`);
  }

  const prompt: string = input?.prompt ?? '';
  if (prompt.length < 20 || prompt.length > 2000) return;
  if (prompt.startsWith('```') || prompt.startsWith('{')) return;

  try {
    const cliPath = process.argv[1]; // absolute path to claude-recall-cli.js
    const child = spawn(
      process.execPath,
      [cliPath, 'hook', 'run', 'cc-capture-worker'],
      { detached: true, stdio: ['pipe', 'ignore', 'ignore'] },
    );

    child.on('error', (err) => {
      hookLog(HOOK_NAME, `capture worker spawn error: ${err?.message ?? err}`);
    });

    if (child.stdin) {
      child.stdin.on('error', (err) => {
        hookLog(HOOK_NAME, `capture worker stdin error: ${err?.message ?? err}`);
      });
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    }

    child.unref();
    hookLog(HOOK_NAME, `capture: spawned detached worker (pid=${child.pid})`);
  } catch (err) {
    hookLog(HOOK_NAME, `capture spawn failed: ${safeErrorMessage(err)}`);
  }
}

/**
 * cc-capture-worker — the background half. Enables the Claude-CLI classifier
 * path (CLAUDE_RECALL_CC_CLASSIFIER) and delegates to the standard
 * correction-detector, which classifies via `claude -p` (subscription) →
 * ANTHROPIC_API_KEY → regex, and stores. Runs detached, so output goes
 * nowhere and capture is silent.
 */
export async function handleCcCaptureWorker(input: any): Promise<void> {
  process.env.CLAUDE_RECALL_CC_CLASSIFIER = '1';
  try {
    await handleCorrectionDetector(input);
  } catch (err) {
    hookLog(HOOK_NAME, `capture worker error: ${safeErrorMessage(err)}`);
  }
}
