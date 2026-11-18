/**
 * Claude-Code-LLM memory classifier.
 *
 * Mirrors kiro-classifier for the Claude Code runtime: `claude -p "<prompt>"`
 * is a headless one-shot completion that runs on the user's Claude Code
 * SUBSCRIPTION auth (the same login powering their interactive session) — no
 * ANTHROPIC_API_KEY, no separate pay-as-you-go credits. This makes the "each
 * runtime brings its own LLM" promise true under Claude Code, not just Kiro.
 *
 * Two hard-won details:
 *
 *  1. `claude -p` prefers ANTHROPIC_API_KEY over subscription auth when the
 *     key is present in the environment. A stray key exported for other tools
 *     (possibly dead or out of credits) would silently hijack the call — so
 *     the key is STRIPPED from the child env to force subscription auth.
 *  2. The child inherits CLAUDE_RECALL_CC_CLASSIFIER=1 (set by the capture
 *     worker), so if the nested headless session fires claude-recall hooks of
 *     its own, handleCcCapture sees the flag and refuses to spawn another
 *     worker — no recursion. The call also runs from the OS temp dir so the
 *     current project's hooks/settings don't load at all.
 *
 * Cold latency is ~4s, so this runs only from a DETACHED worker
 * (cc-capture-worker), never inline on the user's turn.
 */

import * as os from 'os';
import type { ClassifyResult } from './shared';
import { completeWithRuntimeCli } from './runtime-cli';
import { hookLog } from './shared';
import { buildClassifyPrompt, extractClassification } from './kiro-classifier';

const DEFAULT_MODEL = 'haiku';
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Run one headless `claude -p` completion on the user's Claude SUBSCRIPTION
 * and return raw stdout, or null on any failure (claude not on PATH, timeout,
 * non-zero exit). Never throws. This is the generic primitive: capture
 * classification wraps it below, and llm-classifier routes its secondary
 * features (hindsight hints, session extraction, checkpoint extraction,
 * batch classification) through it so none of them require an API key either.
 */
export function completeWithClaudeCli(
  prompt: string,
  opts: { timeoutMs?: number } = {},
): Promise<string | null> {
  const model = process.env.CLAUDE_RECALL_CC_MODEL || DEFAULT_MODEL;
  const envTimeout = parseInt(process.env.CLAUDE_RECALL_CC_LLM_TIMEOUT_MS || '', 10);
  const timeout = opts.timeoutMs
    ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);

  // Force subscription auth: with ANTHROPIC_API_KEY set, `claude -p` bills the
  // key instead of the login — the exact behavior this backend exists to
  // avoid. CLAUDE_RECALL_NESTED marks the child as a nested headless session
  // (every CLI-backend consumer checks it before spawning — recursion guard);
  // CLAUDE_RECALL_CC_CLASSIFIER rides along for the capture-hook guard too.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_RECALL_CC_CLASSIFIER: '1',
    CLAUDE_RECALL_NESTED: '1',
  };
  delete env.ANTHROPIC_API_KEY;

  return completeWithRuntimeCli('claude', ['-p', '--model', model, prompt], {
    tag: 'cc-classifier',
    timeoutMs: timeout,
    // Temp cwd: the nested session must load no project settings or hooks.
    cwd: os.tmpdir(),
    env,
  });
}

/**
 * Classify a prompt by invoking Claude Code's headless mode. Returns null on
 * any failure (claude not on PATH, timeout, non-zero exit, unparseable output)
 * so the caller falls back to the next backend. Never throws.
 */
export async function classifyWithClaudeCli(text: string): Promise<ClassifyResult | null> {
  const model = process.env.CLAUDE_RECALL_CC_MODEL || DEFAULT_MODEL;
  const stdout = await completeWithClaudeCli(buildClassifyPrompt(text));
  if (stdout === null) return null;

  const result = extractClassification(stdout);
  if (!result) {
    // Distinguish a deliberate "none" verdict from unparseable output —
    // "the model said not a rule" and "the call broke" are different
    // diagnoses when reading the log.
    hookLog('cc-classifier', /"type"\s*:\s*"none"/.test(stdout)
      ? 'classified as none (not a durable rule)'
      : 'no parseable classification in claude -p output');
  } else {
    // Same observability contract as kiro-classifier: spell out which
    // backend ran and on whose account, so "which LLM classified this?"
    // is always answerable from the log.
    hookLog('cc-classifier', `classified via claude -p (model=${model}, Claude subscription, no API key): ${result.type} — ${result.extract.slice(0, 60)}`);
  }
  return result;
}
