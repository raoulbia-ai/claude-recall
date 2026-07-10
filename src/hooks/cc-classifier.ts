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

import { spawn } from 'child_process';
import * as os from 'os';
import type { ClassifyResult } from './shared';
import { hookLog, safeErrorMessage } from './shared';
import { buildClassifyPrompt, extractClassification } from './kiro-classifier';

const DEFAULT_MODEL = 'haiku';
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Classify a prompt by invoking Claude Code's headless mode. Returns null on
 * any failure (claude not on PATH, timeout, non-zero exit, unparseable output)
 * so the caller falls back to the next backend. Never throws.
 */
export function classifyWithClaudeCli(text: string): Promise<ClassifyResult | null> {
  const model = process.env.CLAUDE_RECALL_CC_MODEL || DEFAULT_MODEL;
  const timeoutMs = parseInt(process.env.CLAUDE_RECALL_CC_LLM_TIMEOUT_MS || '', 10);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  // Force subscription auth: with ANTHROPIC_API_KEY set, `claude -p` bills the
  // key instead of the login — the exact behavior this classifier exists to
  // avoid. CLAUDE_RECALL_CC_CLASSIFIER rides along as the recursion guard.
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_RECALL_CC_CLASSIFIER: '1' };
  delete env.ANTHROPIC_API_KEY;

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ClassifyResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      // args array (no shell) — the user's text is a single argv entry, so no
      // shell escaping or injection is possible. cwd is the temp dir so the
      // nested session loads no project settings or hooks.
      child = spawn(
        'claude',
        ['-p', '--model', model, buildClassifyPrompt(text)],
        { cwd: os.tmpdir(), env, stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (err) {
      hookLog('cc-classifier', `spawn threw: ${safeErrorMessage(err)}`);
      return done(null);
    }

    const timer = setTimeout(() => {
      hookLog('cc-classifier', `timeout after ${timeout}ms — killing claude -p`);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done(null);
    }, timeout);

    let stdout = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });

    child.on('error', (err: any) => {
      clearTimeout(timer);
      // ENOENT = claude not on PATH; anything else = spawn failure
      hookLog('cc-classifier', `claude error: ${err?.code ?? ''} ${err?.message ?? err}`);
      done(null);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        hookLog('cc-classifier', `claude -p exited ${code}`);
        return done(null);
      }
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
      done(result);
    });
  });
}
