/**
 * Kiro-LLM memory classifier.
 *
 * When Claude Recall runs under Kiro CLI there is no ANTHROPIC_API_KEY, so the
 * usual Haiku classifier (llm-classifier.ts) is unavailable and capture would
 * degrade to regex. But Kiro CLI ships its own LLM and exposes it headlessly:
 * `kiro-cli chat --no-interactive "<prompt>"` runs a one-shot completion on
 * Kiro's model using Kiro's own auth — no API key, no personal subscription.
 * See docs/kiro-llm-capture.md for the full findings.
 *
 * This module shells out to that headless mode to classify a user prompt into
 * the same ClassifyResult shape the rest of the pipeline expects. It runs from
 * a DETACHED worker (kiro-capture-worker), never inline on the user's turn,
 * because a cold `kiro-cli` boot can take ~15s.
 */

import { spawn } from 'child_process';
import type { ClassifyResult } from './shared';
import { hookLog, safeErrorMessage } from './shared';

/** Bare Kiro agent used for classification — no MCP, no hooks, no tools. */
export const CLASSIFIER_AGENT = 'claude-recall-classifier';

const DEFAULT_MODEL = 'claude-haiku-4.5';
const DEFAULT_TIMEOUT_MS = 30000;

const VALID_TYPES = new Set([
  'correction',
  'preference',
  'failure',
  'devops',
  'project-knowledge',
]);

/**
 * The classify instruction, prepended to the user's message. kiro-cli takes a
 * single INPUT argument (no separate system prompt), so instruction + payload
 * are combined. Mirrors the contract of llm-classifier's SYSTEM_PROMPT so
 * downstream thresholds/dedup behave identically regardless of which LLM ran.
 */
function buildPrompt(text: string): string {
  return (
    'You are a memory classifier for a developer tool. Classify the USER MESSAGE ' +
    'into exactly one type and respond with ONLY minified JSON — no markdown, no ' +
    'prose, no code fence:\n' +
    '{"type":"correction|preference|failure|devops|project-knowledge|none","confidence":0.0-1.0,"extract":"<concise imperative rule to remember, or empty>"}\n\n' +
    'Types:\n' +
    '- correction: user correcting a mistake ("no, use X not Y")\n' +
    '- preference: a reusable directive about how the user wants things done ("I prefer X", "we use tabs", "my favourite color is green"). Must apply beyond this one message.\n' +
    '- failure: something broke ("build failed")\n' +
    '- devops: durable CI/CD, git, deployment, or Docker rules\n' +
    '- project-knowledge: architecture, stack, database, or API facts\n' +
    '- none: questions, chitchat, task instructions, observations, or anything not worth remembering across sessions\n\n' +
    'Be conservative: when in doubt use "none" with confidence 0. Use confidence >= 0.75 for correction/preference/devops. ' +
    'extract must be a clean standalone rule (e.g. "Favourite colour is green"), or empty when type is none.\n\n' +
    'USER MESSAGE: ' + text
  );
}

/** Strip ANSI/VT control sequences that kiro-cli writes around its output. */
function stripAnsi(s: string): string {
  // Anchor every strip to the ESC byte (\x1b) so ordinary JSON text —
  // uppercase letters, hyphens, braces — is never touched. First form: CSI
  // (ESC [ ... final byte); second: two-byte ESC <char>. The control char in
  // the pattern is deliberate — that's exactly what we're stripping.
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b[@-_]/g, '');
}

/**
 * Pull the first balanced JSON object out of kiro-cli's decorated stdout.
 * The output looks like `> {"type":...}` or `> json\n{...}`, possibly wrapped
 * in a ```json fence and coloured with ANSI. Returns null if no object parses.
 */
export function extractClassification(raw: string): ClassifyResult | null {
  const cleaned = stripAnsi(raw);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (parsed.type === 'none' || !VALID_TYPES.has(parsed.type)) return null;
  if (typeof parsed.extract !== 'string' || parsed.extract.trim().length === 0) return null;

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;
  return {
    type: parsed.type,
    confidence,
    extract: parsed.extract.trim(),
  };
}

/**
 * Classify a prompt by invoking Kiro's headless LLM. Returns null on any
 * failure (kiro-cli absent, timeout, non-zero exit, unparseable output) so the
 * caller falls back to regex. Never throws.
 */
export function classifyWithKiro(text: string): Promise<ClassifyResult | null> {
  const model = process.env.CLAUDE_RECALL_KIRO_MODEL || DEFAULT_MODEL;
  const timeoutMs = parseInt(process.env.CLAUDE_RECALL_KIRO_LLM_TIMEOUT_MS || '', 10);
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ClassifyResult | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child;
    try {
      // args array (no shell) — the user's text is passed as a single argv
      // entry, so no shell escaping or injection is possible.
      child = spawn(
        'kiro-cli',
        [
          'chat',
          '--no-interactive',
          '--agent', CLASSIFIER_AGENT,
          '--model', model,
          buildPrompt(text),
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
    } catch (err) {
      hookLog('kiro-classifier', `spawn threw: ${safeErrorMessage(err)}`);
      return done(null);
    }

    const timer = setTimeout(() => {
      hookLog('kiro-classifier', `timeout after ${timeout}ms — killing kiro-cli`);
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      done(null);
    }, timeout);

    let stdout = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });

    child.on('error', (err: any) => {
      clearTimeout(timer);
      // ENOENT = kiro-cli not on PATH; anything else = spawn failure
      hookLog('kiro-classifier', `kiro-cli error: ${err?.code ?? ''} ${err?.message ?? err}`);
      done(null);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        hookLog('kiro-classifier', `kiro-cli exited ${code}`);
        return done(null);
      }
      const result = extractClassification(stdout);
      if (!result) {
        hookLog('kiro-classifier', 'no parseable classification in kiro-cli output');
      } else {
        // Log success too, not just failures — otherwise a successful Kiro
        // classification is silent and indistinguishable from "never ran",
        // which makes "did the Kiro LLM handle this?" impossible to answer
        // from the log. Spell out that this ran on Kiro credits (not the
        // ANTHROPIC_API_KEY) using a dedicated classifier model — the `model`
        // is CLAUDE_RECALL_KIRO_MODEL, independent of the interactive chat model.
        hookLog('kiro-classifier', `classified via kiro-cli (model=${model}, Kiro credits, no API key): ${result.type} — ${result.extract.slice(0, 60)}`);
      }
      done(result);
    });
  });
}
