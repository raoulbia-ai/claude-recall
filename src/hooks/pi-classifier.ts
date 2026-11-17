/**
 * Pi runtime LLM backend.
 *
 * Pi ships a headless mode — `pi -p "<prompt>"` — that answers on whatever
 * model the user already configured, exactly as `claude -p` does for Claude
 * Code. So the Pi host needs no API key of its own either.
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

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * One completion from Pi's headless mode. Returns null on any failure (pi not
 * on PATH, timeout, non-zero exit) so the caller falls through. Never throws.
 */
export function completeWithPiCli(
  prompt: string,
  opts: { timeoutMs?: number } = {},
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
    timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    // Temp cwd: the nested session must load no project settings.
    cwd: os.tmpdir(),
    env: { ...process.env, CLAUDE_RECALL_NESTED: '1' },
  });
}
