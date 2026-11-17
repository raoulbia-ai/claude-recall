/**
 * Pi runtime LLM backend.
 *
 * Pi ships a headless mode — `pi -p "<prompt>"` — that answers on whatever
 * model the user already configured, as `claude -p` does for Claude Code. It
 * is opt-in (CLAUDE_RECALL_PI_LLM=1): unlike a Claude subscription, a Pi
 * model is often billed per call.
 *
 * `--no-extensions` is the recursion guard: the nested session loads no
 * extensions at all, so claude-recall cannot re-enter itself. That is stronger
 * than the environment flag the Claude Code backend relies on — but note what
 * it costs: models contributed by an extension are unavailable in the child, so
 * CLAUDE_RECALL_PI_MODEL must name a model from Pi's own configuration, or the
 * host opts into loading extensions with CLAUDE_RECALL_PI_EXTENSIONS.
 */

import * as os from 'os';
import { completeWithRuntimeCli } from './runtime-cli';

/**
 * Whether this process is a Pi host. Set by the Pi extension when it loads.
 *
 * Module state, deliberately not an environment variable: everything Pi spawns
 * inherits its environment, so a `claude` session started from Pi's bash tool
 * would have announced itself as Pi too, and had its hooks answered by Pi.
 */
let piHost = false;

export function announcePiHost(): void {
  piHost = true;
}

/**
 * Whether a completion may go to Pi's headless mode.
 *
 * Off unless the user opts in with CLAUDE_RECALL_PI_LLM=1. Many Pi users run
 * on an API key, so this is paid calls and session text sent to their
 * provider — the same reason a personal ANTHROPIC_API_KEY is opt-in. And never
 * from our own nested child, which must not spawn another.
 */
export function piBackendEnabled(): boolean {
  return piHost
    && process.env.CLAUDE_RECALL_PI_LLM === '1'
    && !process.env.CLAUDE_RECALL_NESTED;
}

/**
 * One completion from Pi's headless mode. Returns null on any failure (pi not
 * on PATH, timeout, non-zero exit) so the caller falls through. Never throws.
 *
 * The deadline is the caller's: every use of this runs inline at the end of a
 * session, where only the caller knows how long the user can be kept waiting.
 */
export function completeWithPiCli(
  prompt: string,
  opts: { timeoutMs: number },
): Promise<string | null> {
  const model = process.env.CLAUDE_RECALL_PI_MODEL;

  // `--no-extensions` is the default guard, but it hides models contributed by
  // an extension — on a host whose provider arrives that way, the child has
  // nothing to answer with. Such a host can opt into loading extensions in the
  // child, where CLAUDE_RECALL_NESTED below is what stops the recursion.
  const isolated = process.env.CLAUDE_RECALL_PI_EXTENSIONS !== '1';
  const args = [
    ...(isolated ? ['--no-extensions'] : []),
    ...(model ? ['--model', model] : []),
    '-p',
    prompt,
  ];

  return completeWithRuntimeCli('pi', args, {
    tag: 'pi-classifier',
    timeoutMs: opts.timeoutMs,
    // Temp cwd: the nested session must load no project settings.
    cwd: os.tmpdir(),
    env: { ...process.env, CLAUDE_RECALL_NESTED: '1' },
    // Pi says why it refused — an unknown model, no credentials — on stderr,
    // and "pi exited 1" alone sends the user looking in the wrong place.
    logStderr: true,
  }).then(stdout => stdout?.trim() || null);
}
