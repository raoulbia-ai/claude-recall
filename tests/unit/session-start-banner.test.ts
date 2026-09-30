/**
 * Tests for the SessionStart affordance banner — the one-line "memory active"
 * feedback shown at the start of every non-compaction session.
 */

const mockLoadActiveRules = jest.fn();
const mockGetProjectId = jest.fn().mockReturnValue('my-project');
const mockHookLog = jest.fn();

jest.mock('../../src/services/memory', () => ({
  MemoryService: { getInstance: () => ({ loadActiveRules: (...a: any[]) => mockLoadActiveRules(...a) }) },
}));
jest.mock('../../src/services/config', () => ({
  ConfigService: { getInstance: () => ({ getProjectId: () => mockGetProjectId() }) },
}));
jest.mock('../../src/hooks/shared', () => ({ hookLog: (...a: any[]) => mockHookLog(...a) }));

import { handleSessionStartBanner } from '../../src/hooks/session-start-banner';

const rules = (over: Partial<Record<string, any[]>> = {}) => ({
  preferences: [], corrections: [], failures: [], devops: [], solutions: [], ...over,
});

describe('handleSessionStartBanner', () => {
  let logs: string[];
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logs = [];
    // Spy on console.log directly — the handler prints via console.log, and
    // jest's own console handling makes a process.stdout.write override unreliable.
    logSpy = jest.spyOn(console, 'log').mockImplementation((...args: any[]) => { logs.push(args.join(' ')); });
  });
  afterEach(() => logSpy.mockRestore());

  it('shows a memory-active banner with the rule count and project on startup', async () => {
    mockLoadActiveRules.mockReturnValue(rules({ preferences: [{}, {}], corrections: [{}] }));
    await handleSessionStartBanner({ hook_event_name: 'SessionStart', source: 'startup' });
    const s = logs.join('\n');
    expect(s).toContain('🧠 Recall: memory active');
    expect(s).toContain('3 rules');
    expect(s).toContain('my-project');
    expect(s).toMatch(/captured automatically/);
  });

  it('shows a "no rules yet" banner when the project has none', async () => {
    mockLoadActiveRules.mockReturnValue(rules());
    await handleSessionStartBanner({ source: 'resume' });
    const s = logs.join('\n');
    expect(s).toContain('no rules yet');
    expect(s).toContain('my-project');
  });

  it('stays SILENT on source "compact" (post-compact-reload owns that case)', async () => {
    mockLoadActiveRules.mockReturnValue(rules({ preferences: [{}] }));
    await handleSessionStartBanner({ hook_event_name: 'SessionStart', source: 'compact' });
    expect(logs.join('\n')).toBe('');
    expect(mockLoadActiveRules).not.toHaveBeenCalled();
  });

  it('never throws if the database is unreachable (fail-safe, no banner)', async () => {
    mockLoadActiveRules.mockImplementation(() => { throw new Error('native binding broken'); });
    await expect(handleSessionStartBanner({ source: 'startup' })).resolves.toBeUndefined();
    expect(logs.join('\n')).toBe('');
    expect(mockHookLog).toHaveBeenCalledWith('session-start-banner', expect.stringMatching(/Error/));
  });
});
