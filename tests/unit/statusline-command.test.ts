/**
 * Tests for `claude-recall statusline` — the user-visible memory indicator for
 * Claude Code's settings.json "statusLine".
 */

const mockLoadActiveRules = jest.fn();
jest.mock('../../src/services/memory', () => ({
  MemoryService: { getInstance: () => ({ loadActiveRules: (...a: any[]) => mockLoadActiveRules(...a) }) },
}));

import { StatuslineCommands } from '../../src/cli/commands/statusline-command';

function captureStdout(): { restore: () => string } {
  const original = process.stdout.write.bind(process.stdout);
  let buffer = '';
  (process.stdout.write as any) = (chunk: any) => { buffer += chunk.toString(); return true; };
  return { restore: () => { (process.stdout.write as any) = original; return buffer; } };
}

const rules = (over: Partial<Record<string, any[]>> = {}) => ({
  preferences: [], corrections: [], failures: [], devops: [], solutions: [], ...over,
});

describe('StatuslineCommands.format', () => {
  it('formats a compact one-liner with pluralization', () => {
    expect(StatuslineCommands.format('my-proj', 2)).toBe('🧠 Recall · 2 rules · my-proj');
    expect(StatuslineCommands.format('my-proj', 1)).toBe('🧠 Recall · 1 rule · my-proj');
    expect(StatuslineCommands.format('my-proj', 0)).toBe('🧠 Recall · 0 rules · my-proj');
  });
});

describe('StatuslineCommands.resolveProjectId', () => {
  const saved = { R: process.env.CLAUDE_RECALL_PROJECT_ID, P: process.env.CLAUDE_PROJECT_ID };
  afterEach(() => {
    process.env.CLAUDE_RECALL_PROJECT_ID = saved.R;
    process.env.CLAUDE_PROJECT_ID = saved.P;
  });

  it('uses the basename of the cwd by default', () => {
    delete process.env.CLAUDE_RECALL_PROJECT_ID;
    delete process.env.CLAUDE_PROJECT_ID;
    expect(StatuslineCommands.resolveProjectId('/home/u/repos/cool-app')).toBe('cool-app');
  });

  it('honors an explicit project-id pin', () => {
    process.env.CLAUDE_RECALL_PROJECT_ID = 'pinned';
    expect(StatuslineCommands.resolveProjectId('/home/u/repos/cool-app')).toBe('pinned');
  });
});

describe('StatuslineCommands.run', () => {
  let cwdSpy: jest.SpyInstance;
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CLAUDE_RECALL_PROJECT_ID;
    delete process.env.CLAUDE_PROJECT_ID;
    // Deterministic: pretend Claude Code reported this project dir on stdin.
    cwdSpy = jest.spyOn(StatuslineCommands, 'stdinCwd').mockReturnValue('/home/u/repos/cool-app');
  });
  afterEach(() => cwdSpy.mockRestore());

  it('prints the memory indicator scoped to the reported project', () => {
    mockLoadActiveRules.mockReturnValue(rules({ preferences: [{}, {}], devops: [{}] }));
    const out = captureStdout();
    StatuslineCommands.run();
    const s = out.restore();
    expect(s.trim()).toBe('🧠 Recall · 3 rules · cool-app');
    expect(mockLoadActiveRules).toHaveBeenCalledWith('cool-app');
  });

  it('falls back to a minimal indicator when the DB is unreachable (never errors)', () => {
    mockLoadActiveRules.mockImplementation(() => { throw new Error('native binding broken'); });
    const out = captureStdout();
    StatuslineCommands.run();
    expect(out.restore().trim()).toBe('🧠 Recall');
  });
});

describe('StatuslineCommands — rules vs auto-captured failures', () => {
  it('does not call auto-captured failures "rules"', () => {
    // 2 taught rules + 3 failures must not read as "5 rules"
    expect(StatuslineCommands.format('my-proj', 2, 3)).toBe('🧠 Recall · 2 rules · 3 failures · my-proj');
    expect(StatuslineCommands.format('my-proj', 0, 1)).toBe('🧠 Recall · 0 rules · 1 failure · my-proj');
  });
  it('omits the failure segment when there are none', () => {
    expect(StatuslineCommands.format('my-proj', 2, 0)).toBe('🧠 Recall · 2 rules · my-proj');
  });
});
