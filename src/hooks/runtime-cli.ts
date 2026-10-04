import { spawn } from 'child_process';
import { hookLog, safeErrorMessage } from './shared';

/**
 * Run a runtime's own headless CLI for one completion.
 *
 * Every supported runtime ships a binary that answers a single prompt on the
 * user's existing subscription — `claude -p`, `kiro-cli chat`, `pi -p` — which
 * is why claude-recall needs no API key of its own. The three backends differ
 * only in argv and environment, so the spawn, the kill-on-timeout and the
 * stdout handling live here once.
 *
 * Never throws and never rejects: a missing binary, a timeout or a non-zero
 * exit all resolve to null, and the caller falls through to its next backend.
 */
export interface RuntimeCliOptions {
	/** Log prefix identifying the backend. */
	tag: string;
	/** Hard deadline; the child is SIGKILLed when it passes. */
	timeoutMs: number;
	/** Working directory — use a temp dir to keep project config out of the child. */
	cwd?: string;
	/** Replaces the child environment entirely when given. */
	env?: NodeJS.ProcessEnv;
}

export function completeWithRuntimeCli(
	command: string,
	args: readonly string[],
	opts: RuntimeCliOptions,
): Promise<string | null> {
	return new Promise((resolve) => {
		let settled = false;
		const done = (result: string | null) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		let child;
		try {
			// args array (no shell) — the prompt is a single argv entry, so no
			// shell escaping or injection is possible.
			child = spawn(command, [...args], {
				cwd: opts.cwd,
				env: opts.env,
				stdio: ['ignore', 'pipe', 'ignore'],
			});
		} catch (err) {
			hookLog(opts.tag, `spawn threw: ${safeErrorMessage(err)}`);
			return done(null);
		}

		const timer = setTimeout(() => {
			hookLog(opts.tag, `timeout after ${opts.timeoutMs}ms — killing ${command}`);
			try { child.kill('SIGKILL'); } catch { /* already gone */ }
			done(null);
		}, opts.timeoutMs);

		let stdout = '';
		child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });

		child.on('error', (err: any) => {
			clearTimeout(timer);
			// ENOENT = binary not on PATH; anything else = spawn failure
			hookLog(opts.tag, `${command} error: ${err?.code ?? ''} ${err?.message ?? err}`);
			done(null);
		});

		child.on('close', (code) => {
			clearTimeout(timer);
			if (settled) return;
			if (code !== 0) {
				hookLog(opts.tag, `${command} exited ${code}`);
				return done(null);
			}
			done(stdout.trim() || null);
		});
	});
}
