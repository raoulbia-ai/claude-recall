import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mockCapture = jest.fn();
jest.mock('../../src/hooks/cc-capture', () => ({
  handleCcCapture: (...a: any[]) => mockCapture(...a),
  handleCcCaptureWorker: jest.fn(),
}));

import { HookCommands } from '../../src/cli/commands/hook-commands';
import { MemoryService } from '../../src/services/memory';
import {
  QUARANTINE_DENY_RULES, addQuarantineDenyRules, missingQuarantineDenyRules,
} from '../../src/cli/commands/quarantine-permissions';
import { DoctorCommands } from '../../src/cli/commands/doctor-commands';

describe('Claude Code prompt hook: in-session review', () => {
  const run = async (prompt: string) => {
    const out: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((s: any) => { out.push(String(s)); return true; });
    try {
      await (HookCommands as any).runOne('correction-detector', { prompt, session_id: `hook-test-${Date.now()}` });
    } finally {
      spy.mockRestore();
    }
    return out.join('');
  };

  beforeEach(() => {
    mockCapture.mockReset();
    MemoryService.getInstance().getStorage().getDatabase().prepare('DELETE FROM memories').run();
    MemoryService.getInstance().store({ key: 'q1', origin: 'agent', type: 'devops', value: { content: 'deploy from any branch' } });
  });

  it('blocks a review command, shows the user the review, and captures nothing', async () => {
    const out = await run('recall review');
    const json = JSON.parse(out);
    expect(json.decision).toBe('block');
    expect(json.reason).toContain('deploy from any branch');
    expect(json.hookSpecificOutput).toEqual({ hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true });
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('passes an ordinary prompt on to capture, printing nothing', async () => {
    expect(await run('please always use pnpm in this repo')).toBe('');
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });
});

describe('quarantine deny rules', () => {
  it('adds the rules once, keeping existing ones', () => {
    const settings: any = { permissions: { deny: ['Bash(rm -rf *)'] } };
    expect(addQuarantineDenyRules(settings)).toBe(QUARANTINE_DENY_RULES.length);
    expect(addQuarantineDenyRules(settings)).toBe(0);
    expect(settings.permissions.deny[0]).toBe('Bash(rm -rf *)');
    expect(missingQuarantineDenyRules(settings)).toEqual([]);
  });

  it('works on settings with no permissions block', () => {
    const settings: any = {};
    addQuarantineDenyRules(settings);
    expect(settings.permissions.deny).toEqual([...QUARANTINE_DENY_RULES]);
  });

  it('doctor reports missing rules, and --fix adds them with a backup', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-perm-'));
    try {
      fs.mkdirSync(path.join(home, '.claude'));
      const file = path.join(home, '.claude', 'settings.json');
      fs.writeFileSync(file, JSON.stringify({ hooks: {} }));
      const logs: string[] = [];
      expect(DoctorCommands.reportQuarantineDenyRules(home, false, m => logs.push(m))).toBe(1);
      expect(logs.join('\n')).toMatch(/could approve quarantined memories/);

      expect(DoctorCommands.reportQuarantineDenyRules(home, true, () => {})).toBe(0);
      expect(JSON.parse(fs.readFileSync(file, 'utf8')).permissions.deny).toEqual([...QUARANTINE_DENY_RULES]);
      expect(fs.readdirSync(path.join(home, '.claude')).some(f => f.startsWith('settings.json.bak-'))).toBe(true);
      expect(DoctorCommands.reportQuarantineDenyRules(home, false, () => {})).toBe(0);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
