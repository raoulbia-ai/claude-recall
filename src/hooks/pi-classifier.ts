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
 * CLAUDE_RECALL_PI_MODEL must name a model from Pi's own configuration.
 */

import * as os from 'os';
import type { ClassifyResult } from './shared';
import { completeWithRuntimeCli } from './runtime-cli';
import { buildClassifyPrompt, extractClassification } from './kiro-classifier';

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
	const envTimeout = parseInt(process.env.CLAUDE_RECALL_PI_LLM_TIMEOUT_MS || '', 10);
	const timeout = opts.timeoutMs
		?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS);

	// Without a model the child uses Pi's configured default, which keeps this
	// backend working with no setup at all.
	const args = ['--no-extensions', ...(model ? ['--model', model] : []), '-p', prompt];

	return completeWithRuntimeCli('pi', args, {
		tag: 'pi-classifier',
		timeoutMs: timeout,
		// Temp cwd: the nested session must load no project settings.
		cwd: os.tmpdir(),
		env: { ...process.env, CLAUDE_RECALL_NESTED: '1' },
	});
}

/**
 * Classify a prompt through Pi. Returns null on any failure, including output
 * that does not parse, so the caller falls back to the next backend.
 */
export async function classifyWithPiCli(text: string): Promise<ClassifyResult | null> {
	const raw = await completeWithPiCli(buildClassifyPrompt(text));
	return raw ? extractClassification(raw) : null;
}
