import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DoctorCommands } from '../../src/cli/commands/doctor-commands';

const resolverYes = () => '/usr/bin/claude-recall';

function mkTmp(prefix = 'doctor-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
function mkVersionedScript(home: string, version: string): string {
  const dir = path.join(home, '.nvm', 'versions', 'node', version, 'lib', 'node_modules', 'claude-recall', 'dist', 'cli');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'claude-recall-cli.js');
  fs.writeFileSync(p, '// stub');
  return p;
}

describe('DoctorCommands.describeHookFinding', () => {
  const settings = '/home/u/project/.claude/settings.json';

  it('describes an orphaned-node finding with both node versions', () => {
    const d = DoctorCommands.describeHookFinding(settings, {
      status: 'orphaned-node', scriptPath: '/x', scriptNodeVersion: 'v18.0.0', hookId: 'rule-injector',
    });
    expect(d).toContain('v18.0.0');
    expect(d).toContain(process.version);
    expect(d).toContain('crash on load');
  });

  it('describes broken-absolute and broken-path findings', () => {
    expect(DoctorCommands.describeHookFinding(settings, { status: 'broken-absolute', scriptPath: '/gone.js', hookId: 'x' }))
      .toContain('missing script');
    expect(DoctorCommands.describeHookFinding(settings, { status: 'broken-path', binary: 'claude-recall', hookId: 'x' }))
      .toContain('not on PATH');
  });
});

describe('DoctorCommands.reportHooks', () => {
  it('flags an orphaned-node hook and returns a non-zero problem count (fix=false)', async () => {
    const home = mkTmp();
    try {
      const script = mkVersionedScript(home, 'v18.0.0');
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `node ${script} hook run rule-injector` }] }] },
      }));

      const msgs: string[] = [];
      const problems = await DoctorCommands.reportHooks(home, home, false, m => msgs.push(m), resolverYes);

      expect(problems).toBe(1);
      const out = msgs.join('\n');
      expect(out).toMatch(/orphaned|crash on load|v18\.0\.0/);
      expect(out).toContain('doctor --fix');
    } finally { rmTmp(home); }
  });

  it('reports healthy when all hooks use the PATH form', async () => {
    const home = mkTmp();
    try {
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
        hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'claude-recall hook run rule-injector' }] }] },
      }));
      const msgs: string[] = [];
      // Inject a resolver that finds claude-recall on PATH, so a PATH-form hook
      // classifies as ok regardless of the CI environment's global install.
      const problems = await DoctorCommands.reportHooks(home, home, false, m => msgs.push(m), resolverYes);
      expect(problems).toBe(0);
      expect(msgs.join('\n')).toMatch(/healthy/);
    } finally { rmTmp(home); }
  });
});
