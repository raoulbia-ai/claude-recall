/**
 * session-end-checkpoint hook — fires on Claude Code SessionEnd event.
 *
 * Goal: auto-save a "where I left off" checkpoint when the session ends, so
 * the next session can pick up from the most recent task. Less critical for
 * Claude Code (which has `claude --resume`) than for Pi, but still useful
 * for users who exit and start fresh instead of resuming.
 *
 * Architecture: this handler is the SYNCHRONOUS gate that Claude Code's hook
 * runner waits on. SessionEnd hooks have a tight default timeout (1.5s — see
 * cc-source-code/utils/hooks.ts:175 SESSION_END_HOOK_TIMEOUT_MS_DEFAULT) which
 * is too short for transcript-read + Haiku call + DB write.
 *
 * Solution: this handler spawns a DETACHED worker process that does the real
 * work in the background, then returns instantly. The worker survives the
 * parent's exit and writes the checkpoint asynchronously. Worst case race:
 * if the user starts a new session before the worker finishes, the new
 * session sees no checkpoint — graceful degradation, not data loss.
 *
 * Reason filter: only fires for voluntary user exits (clear, prompt_input_exit,
 * logout, resume). Skips system-driven exits (bypass_permissions_disabled, other)
 * because those don't represent user intent to pause.
 */

import { spawn } from 'child_process';
import { hookLog } from './shared';

const SKIP_REASONS = new Set(['bypass_permissions_disabled', 'other']);

export async function handleSessionEndCheckpoint(input: any): Promise<void> {
  const reason: string = input?.reason ?? 'unknown';

  if (SKIP_REASONS.has(reason)) {
    hookLog('session-end-checkpoint', `Skipping (reason=${reason})`);
    return;
  }

  if (!input?.transcript_path) {
    hookLog('session-end-checkpoint', 'No transcript_path in input — nothing to extract');
    return;
  }

  try {
    // process.argv[1] is the absolute path to claude-recall-cli.js (whichever
    // entry the parent hook ran from). Reuse the same binary so the worker
    // picks up the same dist version, MemoryService singleton path, env, etc.
    const cliPath = process.argv[1];

    const child = spawn(
      process.execPath, // node binary path
      [cliPath, 'hook', 'run', 'session-end-checkpoint-worker'],
      {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        // Inherit cwd so getProjectId() resolves correctly in the worker
      },
    );

    if (child.stdin) {
      child.stdin.write(JSON.stringify(input));
      child.stdin.end();
    }

    // Detach so the worker outlives the parent. The hook handler returns
    // immediately, well within Claude Code's 1.5s SessionEnd timeout.
    child.unref();

    hookLog('session-end-checkpoint', `Spawned detached worker (pid=${child.pid}, reason=${reason})`);
  } catch (err: any) {
    hookLog('session-end-checkpoint', `Failed to spawn worker: ${err?.message ?? err}`);
    // Best-effort — never block the hook
  }
}
