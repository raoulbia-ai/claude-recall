const mockSpawn = jest.fn();
jest.mock('child_process', () => ({ spawn: (...args: unknown[]) => mockSpawn(...args) }));

import { EventEmitter } from 'events';
import * as os from 'os';

/**
 * Pi's headless mode is the Pi host's equivalent of `claude -p`: it answers on
 * the model the user already configured, so no API key is needed here either.
 */
describe('Pi LLM backend', () => {
	const prev = { ...process.env };

	function fakeChild(opts: { stdout?: string; code?: number } = {}) {
		const child: any = new EventEmitter();
		child.stdout = new EventEmitter();
		child.kill = jest.fn();
		setImmediate(() => {
			if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout));
			child.emit('close', opts.code ?? 0);
		});
		return child;
	}

	beforeEach(() => {
		jest.resetModules();
		mockSpawn.mockReset();
		for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_RECALL_')) delete process.env[k];
	});

	afterAll(() => { process.env = prev; });

	const load = () => require('../../src/hooks/pi-classifier');

	it('runs Pi headless and returns its answer', async () => {
		mockSpawn.mockReturnValue(fakeChild({ stdout: '  a lesson  ' }));

		await expect(load().completeWithPiCli('why did it fail?')).resolves.toBe('a lesson');

		const [command, args] = mockSpawn.mock.calls[0];
		expect(command).toBe('pi');
		expect(args).toEqual(['--no-extensions', '-p', 'why did it fail?']);
	});

	it('disables extensions in the child, so it cannot re-enter claude-recall', async () => {
		mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

		await load().completeWithPiCli('prompt');

		const [, args, options] = mockSpawn.mock.calls[0];
		expect(args).toContain('--no-extensions');
		expect(options.env.CLAUDE_RECALL_NESTED).toBe('1');
		expect(options.cwd).toBe(os.tmpdir());
	});

	it('can load extensions in the child when the host keeps its models there', async () => {
		process.env.CLAUDE_RECALL_PI_EXTENSIONS = '1';
		mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

		await load().completeWithPiCli('prompt');

		const [, args, options] = mockSpawn.mock.calls[0];
		expect(args).not.toContain('--no-extensions');
		// Recursion is then stopped by the flag instead, which the extension honours.
		expect(options.env.CLAUDE_RECALL_NESTED).toBe('1');
	});

	it('passes a configured model through', async () => {
		process.env.CLAUDE_RECALL_PI_MODEL = 'airpx-static/claude-sonnet-5';
		mockSpawn.mockReturnValue(fakeChild({ stdout: 'ok' }));

		await load().completeWithPiCli('prompt');

		expect(mockSpawn.mock.calls[0][1]).toEqual([
			'--no-extensions', '--model', 'airpx-static/claude-sonnet-5', '-p', 'prompt',
		]);
	});

	it('returns null on a non-zero exit rather than throwing', async () => {
		mockSpawn.mockReturnValue(fakeChild({ stdout: 'partial', code: 1 }));

		await expect(load().completeWithPiCli('prompt')).resolves.toBeNull();
	});

	it('returns null when pi is not on PATH', async () => {
		const child: any = new EventEmitter();
		child.stdout = new EventEmitter();
		child.kill = jest.fn();
		setImmediate(() => child.emit('error', Object.assign(new Error('not found'), { code: 'ENOENT' })));
		mockSpawn.mockReturnValue(child);

		await expect(load().completeWithPiCli('prompt')).resolves.toBeNull();
	});

	it('kills the child when it outlives the deadline', async () => {
		jest.useFakeTimers();
		const child: any = new EventEmitter();
		child.stdout = new EventEmitter();
		child.kill = jest.fn();
		mockSpawn.mockReturnValue(child);

		const pending = load().completeWithPiCli('prompt', { timeoutMs: 1000 });
		jest.advanceTimersByTime(1001);

		await expect(pending).resolves.toBeNull();
		expect(child.kill).toHaveBeenCalledWith('SIGKILL');
		jest.useRealTimers();
	});
});

describe('backend selection', () => {
	const prev = { ...process.env };

	beforeEach(() => {
		jest.resetModules();
		mockSpawn.mockReset();
		for (const k of Object.keys(process.env)) if (k.startsWith('CLAUDE_RECALL_')) delete process.env[k];
		delete process.env.ANTHROPIC_API_KEY;
	});

	afterAll(() => { process.env = prev; });

	it('does not reach for Pi unless the runtime says it is Pi', async () => {
		mockSpawn.mockReturnValue({ stdout: new EventEmitter(), on: jest.fn(), kill: jest.fn() });

		await require('../../src/hooks/llm-classifier').extractHindsightHint('failed', 'context');

		// Only the Claude CLI may be attempted on a host that has not announced Pi
		expect(mockSpawn.mock.calls.every(([cmd]: [string]) => cmd !== 'pi')).toBe(true);
	});
});
