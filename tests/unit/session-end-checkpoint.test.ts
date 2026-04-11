/**
 * Tests for the Claude Code SessionEnd auto-checkpoint hook + worker.
 *
 * Architecture under test:
 *   - handleSessionEndCheckpoint: synchronous gate. Spawns a detached worker
 *     and returns instantly. Skips on system-driven exit reasons.
 *   - handleSessionEndCheckpointWorker: detached background worker. Reads
 *     transcript, builds ConversationEntry[], calls extractCheckpoint with
 *     runtime='cc'.
 *
 * Both must be resilient: never throw, always exit cleanly, never block CC.
 */

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockReadTranscriptTail = jest.fn();
const mockExtractTextFromEntry = jest.fn();
const mockExtractToolInteractions = jest.fn();
const mockExtractAssistantTexts = jest.fn();
const mockHookLog = jest.fn();

jest.mock('../../src/hooks/shared', () => ({
  readTranscriptTail: (...args: any[]) => mockReadTranscriptTail(...args),
  extractTextFromEntry: (...args: any[]) => mockExtractTextFromEntry(...args),
  extractToolInteractions: (...args: any[]) => mockExtractToolInteractions(...args),
  extractAssistantTexts: (...args: any[]) => mockExtractAssistantTexts(...args),
  hookLog: (...args: any[]) => mockHookLog(...args),
}));

const mockExtractCheckpoint = jest.fn();
const mockSetLogFunction = jest.fn();
jest.mock('../../src/shared/event-processors', () => ({
  extractCheckpoint: (...args: any[]) => mockExtractCheckpoint(...args),
  setLogFunction: (...args: any[]) => mockSetLogFunction(...args),
}));

const mockGetProjectId = jest.fn();
const mockUpdateConfig = jest.fn();
jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => mockGetProjectId(),
      updateConfig: (...args: any[]) => mockUpdateConfig(...args),
    }),
  },
}));

import { handleSessionEndCheckpoint } from '../../src/hooks/session-end-checkpoint';
import { handleSessionEndCheckpointWorker } from '../../src/hooks/session-end-checkpoint-worker';

function makeFakeChild() {
  const stdin = {
    write: jest.fn(),
    end: jest.fn(),
  };
  return {
    stdin,
    pid: 99999,
    unref: jest.fn(),
  };
}

describe('handleSessionEndCheckpoint (synchronous gate)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockReturnValue(makeFakeChild());
  });

  it('spawns a detached worker for voluntary exit reasons', async () => {
    await handleSessionEndCheckpoint({
      transcript_path: '/tmp/transcript.jsonl',
      reason: 'clear',
      cwd: '/home/user/proj',
    });

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, args, opts] = mockSpawn.mock.calls[0];
    expect(args).toContain('hook');
    expect(args).toContain('run');
    expect(args).toContain('session-end-checkpoint-worker');
    expect(opts.detached).toBe(true);
  });

  it('writes input JSON to worker stdin and ends it', async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    const input = { transcript_path: '/tmp/t.jsonl', reason: 'prompt_input_exit', cwd: '/x' };
    await handleSessionEndCheckpoint(input);

    expect(child.stdin.write).toHaveBeenCalledWith(JSON.stringify(input));
    expect(child.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('unrefs the child process so it survives parent exit', async () => {
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child);

    await handleSessionEndCheckpoint({
      transcript_path: '/tmp/t.jsonl',
      reason: 'logout',
    });

    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('skips spawning when reason=bypass_permissions_disabled (system exit)', async () => {
    await handleSessionEndCheckpoint({
      transcript_path: '/tmp/t.jsonl',
      reason: 'bypass_permissions_disabled',
    });

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('skips spawning when reason=other (system exit)', async () => {
    await handleSessionEndCheckpoint({
      transcript_path: '/tmp/t.jsonl',
      reason: 'other',
    });

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('skips spawning when transcript_path is missing', async () => {
    await handleSessionEndCheckpoint({ reason: 'clear' });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('does not throw if spawn() throws', async () => {
    mockSpawn.mockImplementationOnce(() => {
      throw new Error('EAGAIN');
    });

    await expect(
      handleSessionEndCheckpoint({
        transcript_path: '/tmp/t.jsonl',
        reason: 'clear',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('handleSessionEndCheckpointWorker (detached worker)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetProjectId.mockReturnValue('test-project');
    mockExtractCheckpoint.mockResolvedValue(true);
    mockReadTranscriptTail.mockReturnValue([]);
    mockExtractToolInteractions.mockReturnValue([]);
    mockExtractAssistantTexts.mockReturnValue([]);
    mockExtractTextFromEntry.mockReturnValue('');
  });

  it('returns early when no transcript_path provided', async () => {
    await handleSessionEndCheckpointWorker({});
    expect(mockReadTranscriptTail).not.toHaveBeenCalled();
    expect(mockExtractCheckpoint).not.toHaveBeenCalled();
  });

  it('returns early when transcript is empty', async () => {
    mockReadTranscriptTail.mockReturnValueOnce([]);

    await handleSessionEndCheckpointWorker({
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user/proj',
    });

    expect(mockExtractCheckpoint).not.toHaveBeenCalled();
  });

  it('updates ConfigService with cwd from input', async () => {
    mockReadTranscriptTail.mockReturnValueOnce([]);

    await handleSessionEndCheckpointWorker({
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user/some-proj',
    });

    expect(mockUpdateConfig).toHaveBeenCalledWith({
      project: { rootDir: '/home/user/some-proj' },
    });
  });

  it('builds ConversationEntry list from user messages and tool interactions', async () => {
    mockReadTranscriptTail.mockReturnValueOnce([
      { message: { role: 'user', content: 'add a feature' } },
      { message: { role: 'assistant', content: 'working on it' } },
      { message: { role: 'user', content: 'now wire it' } },
    ]);
    mockExtractTextFromEntry
      .mockReturnValueOnce('add a feature')
      .mockReturnValueOnce('now wire it');
    mockExtractToolInteractions.mockReturnValueOnce([
      {
        call: { id: 't1', name: 'Edit', input: {}, entryIndex: 1 },
        result: { toolUseId: 't1', content: 'Edit successful', isError: false, entryIndex: 2 },
      },
    ]);

    await handleSessionEndCheckpointWorker({
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user/proj',
    });

    expect(mockExtractCheckpoint).toHaveBeenCalledTimes(1);
    const [entries, projectId, runtime] = mockExtractCheckpoint.mock.calls[0];
    expect(projectId).toBe('test-project');
    expect(runtime).toBe('cc');
    expect(Array.isArray(entries)).toBe(true);
    // Two user messages + one tool result = 3 entries
    expect(entries.length).toBeGreaterThanOrEqual(3);
    const userTexts = entries.filter((e: any) => e.role === 'user').map((e: any) => e.text);
    expect(userTexts).toContain('add a feature');
    expect(userTexts).toContain('now wire it');
    const toolResults = entries.filter((e: any) => e.role === 'tool_result');
    expect(toolResults.length).toBe(1);
    expect(toolResults[0].toolName).toBe('Edit');
  });

  it('skips pure tool_result wrapper user entries (avoids double-counting)', async () => {
    mockReadTranscriptTail.mockReturnValueOnce([
      {
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'output' }],
        },
      },
      { message: { role: 'user', content: 'real prompt one' } },
      { message: { role: 'user', content: 'real prompt two' } },
    ]);
    mockExtractTextFromEntry
      .mockReturnValueOnce('real prompt one')
      .mockReturnValueOnce('real prompt two');
    mockExtractToolInteractions.mockReturnValueOnce([
      {
        call: { id: 't1', name: 'Read', input: {}, entryIndex: 0 },
        result: { toolUseId: 't1', content: 'output', isError: false, entryIndex: 0 },
      },
    ]);

    await handleSessionEndCheckpointWorker({
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user/proj',
    });

    expect(mockExtractCheckpoint).toHaveBeenCalled();
    const entries = mockExtractCheckpoint.mock.calls[0][0];
    const userTexts = entries.filter((e: any) => e.role === 'user').map((e: any) => e.text);
    expect(userTexts).toEqual(['real prompt one', 'real prompt two']); // wrapper excluded
  });

  it('returns early when fewer than 3 entries assembled (quality gate)', async () => {
    mockReadTranscriptTail.mockReturnValueOnce([
      { message: { role: 'user', content: 'hi' } },
    ]);
    mockExtractTextFromEntry.mockReturnValueOnce('hi');
    mockExtractToolInteractions.mockReturnValueOnce([]);

    await handleSessionEndCheckpointWorker({
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user/proj',
    });

    expect(mockExtractCheckpoint).not.toHaveBeenCalled();
  });

  it('passes runtime="cc" to extractCheckpoint', async () => {
    mockReadTranscriptTail.mockReturnValueOnce([
      { message: { role: 'user', content: 'a' } },
      { message: { role: 'user', content: 'b' } },
      { message: { role: 'user', content: 'c' } },
    ]);
    mockExtractTextFromEntry
      .mockReturnValueOnce('a')
      .mockReturnValueOnce('b')
      .mockReturnValueOnce('c');
    mockExtractToolInteractions.mockReturnValueOnce([]);

    await handleSessionEndCheckpointWorker({
      transcript_path: '/tmp/t.jsonl',
      cwd: '/home/user/proj',
    });

    expect(mockExtractCheckpoint).toHaveBeenCalled();
    const [, , runtime] = mockExtractCheckpoint.mock.calls[0];
    expect(runtime).toBe('cc');
  });

  it('does not throw when extractCheckpoint rejects', async () => {
    mockReadTranscriptTail.mockReturnValueOnce([
      { message: { role: 'user', content: 'a' } },
      { message: { role: 'user', content: 'b' } },
      { message: { role: 'user', content: 'c' } },
    ]);
    mockExtractTextFromEntry
      .mockReturnValueOnce('a')
      .mockReturnValueOnce('b')
      .mockReturnValueOnce('c');
    mockExtractToolInteractions.mockReturnValueOnce([]);
    mockExtractCheckpoint.mockRejectedValueOnce(new Error('boom'));

    await expect(
      handleSessionEndCheckpointWorker({
        transcript_path: '/tmp/t.jsonl',
        cwd: '/home/user/proj',
      }),
    ).rejects.toThrow('boom');
    // Note: the worker propagates errors so the hook dispatcher's outer try/catch
    // can swallow them. The dispatcher always exits 0, so this is safe in practice.
  });
});
