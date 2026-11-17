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

describe('DoctorCommands minimal-PATH launch check', () => {
  function writeExe(dir: string, name: string, body: string): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body, { mode: 0o755 });
    return p;
  }

  it('probe: passes a launcher that runs with only system dirs on PATH', () => {
    const home = mkTmp();
    try {
      const ok = writeExe(home, 'claude-recall-wrap', '#!/bin/sh\necho 0.0.0\n');
      expect(DoctorCommands.probeMinimalPath(ok, home)).toEqual({ ok: true });
    } finally { rmTmp(home); }
  });

  it('probe: fails a script whose interpreter is not on the minimal PATH (the nvm case)', () => {
    const home = mkTmp();
    try {
      const bad = writeExe(home, 'claude-recall', '#!/usr/bin/env claude-recall-no-such-node\n');
      const r = DoctorCommands.probeMinimalPath(bad, home);
      expect(r.ok).toBe(false);
    } finally { rmTmp(home); }
  });

  it('probe: fails a bare name the minimal PATH cannot resolve', () => {
    const home = mkTmp();
    try {
      const binDir = path.join(home, 'nvm-bin');
      fs.mkdirSync(binDir);
      writeExe(binDir, 'claude-recall', '#!/bin/sh\necho 0.0.0\n');
      expect(DoctorCommands.probeMinimalPath('claude-recall', home, '/nonexistent-dir')).toEqual({
        ok: false, reason: "'claude-recall' not found",
      });
      // ...but the same name resolves once its dir is on PATH.
      expect(DoctorCommands.probeMinimalPath('claude-recall', home, `${binDir}:/usr/bin:/bin`).ok).toBe(true);
    } finally { rmTmp(home); }
  });

  it('collects MCP, hook and statusLine commands', () => {
    const home = mkTmp();
    try {
      fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({
        mcpServers: { 'claude-recall': { type: 'stdio', command: 'claude-recall', args: ['mcp', 'start'] } },
      }));
      fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'claude-recall hook run memory-stop' }] }] },
        statusLine: { type: 'command', command: 'claude-recall statusline' },
      }));
      const { scanMcpConfig } = require('../../src/cli/commands/mcp-config-repair');
      const cmds = DoctorCommands.collectLaunchCommands(home, home, scanMcpConfig(home));
      expect(cmds.map(c => c.source)).toEqual(expect.arrayContaining(['MCP server (user scope)', 'hooks', 'statusLine']));
    } finally { rmTmp(home); }
  });

  it('report: groups by executable, warns once per failing launcher, points at the README fix', () => {
    const msgs: string[] = [];
    const n = DoctorCommands.reportMinimalPathLaunch(
      [
        { source: 'MCP server (user scope)', command: 'claude-recall' },
        { source: 'hooks', command: 'claude-recall hook run rule-injector' },
        { source: 'hooks', command: 'claude-recall hook run memory-sync' },
      ],
      '/home/u', m => msgs.push(m), () => ({ ok: false, reason: "'claude-recall' not found" }));
    expect(n).toBe(1);
    const out = msgs.join('\n');
    expect(out).toContain('MCP server (user scope), hooks');
    expect(out).toContain('Executable not found');
  });

  it('report: all launchers healthy → single check mark, zero warnings', () => {
    const msgs: string[] = [];
    const n = DoctorCommands.reportMinimalPathLaunch(
      [{ source: 'hooks', command: '/home/u/.local/bin/claude-recall-wrap hook run x' }],
      '/home/u', m => msgs.push(m), () => ({ ok: true }));
    expect(n).toBe(0);
    expect(msgs.join('\n')).toContain('✓');
  });
});
