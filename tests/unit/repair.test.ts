import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  classifyHook,
  findSettingsFiles,
  scanFile,
  applyFixes,
  runRepair,
} from '../../src/cli/commands/repair';

function mkTmp(prefix = 'repair-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

const resolverYes = () => '/usr/bin/claude-recall';
const resolverNo = () => null;

describe('classifyHook', () => {
  it('classifies non-claude-recall commands as non-claude-recall', () => {
    expect(classifyHook('python3 /home/u/.claude/hooks/enforcer.py', resolverYes))
      .toEqual({ status: 'non-claude-recall' });
    expect(classifyHook('echo hello', resolverYes))
      .toEqual({ status: 'non-claude-recall' });
    expect(classifyHook('', resolverYes))
      .toEqual({ status: 'non-claude-recall' });
  });

  it('classifies an OK node+absolute-path claude-recall hook', () => {
    const tmp = mkTmp();
    const scriptPath = path.join(tmp, 'claude-recall-cli.js');
    fs.writeFileSync(scriptPath, '// stub');
    try {
      const cmd = `node ${scriptPath} hook run memory-stop`;
      expect(classifyHook(cmd, resolverYes)).toEqual({ status: 'ok' });
    } finally {
      rmTmp(tmp);
    }
  });

  it('classifies a missing absolute script as broken-absolute with hookId extracted', () => {
    const cmd = 'node /home/openclaw/node_modules/claude-recall/dist/cli/claude-recall-cli.js hook run memory-stop';
    const result = classifyHook(cmd, resolverYes);
    expect(result).toEqual({
      status: 'broken-absolute',
      scriptPath: '/home/openclaw/node_modules/claude-recall/dist/cli/claude-recall-cli.js',
      hookId: 'memory-stop',
    });
  });

  it('classifies a missing absolute script with no hook-run subcommand (hookId null)', () => {
    const cmd = 'node /home/nope/claude-recall-cli.js something-else';
    const result = classifyHook(cmd, resolverYes);
    expect(result).toMatchObject({ status: 'broken-absolute', hookId: null });
  });

  it('classifies `claude-recall hook run ...` as OK when on PATH', () => {
    expect(classifyHook('claude-recall hook run memory-stop', resolverYes))
      .toEqual({ status: 'ok' });
  });

  it('classifies `claude-recall hook run ...` as broken-path when not on PATH', () => {
    const result = classifyHook('claude-recall hook run memory-stop', resolverNo);
    expect(result).toEqual({
      status: 'broken-path',
      binary: 'claude-recall',
      hookId: 'memory-stop',
    });
  });

  it('treats `npx claude-recall ...` as OK (resolved at runtime)', () => {
    expect(classifyHook('npx claude-recall hook run memory-stop', resolverNo))
      .toEqual({ status: 'ok' });
  });
});

describe('findSettingsFiles', () => {
  it('returns only files that exist (user scope)', () => {
    const tmp = mkTmp();
    try {
      const userClaude = path.join(tmp, '.claude');
      fs.mkdirSync(userClaude, { recursive: true });
      fs.writeFileSync(path.join(userClaude, 'settings.json'), '{}');
      const results = findSettingsFiles('/irrelevant', tmp, 'user');
      expect(results).toEqual([path.join(userClaude, 'settings.json')]);
    } finally {
      rmTmp(tmp);
    }
  });

  it('walks up for project scope and stops at closest .claude', () => {
    const tmp = mkTmp();
    try {
      const projRoot = path.join(tmp, 'proj');
      const deep = path.join(projRoot, 'a', 'b', 'c');
      fs.mkdirSync(deep, { recursive: true });
      const claudeDir = path.join(projRoot, '.claude');
      fs.mkdirSync(claudeDir);
      fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}');
      fs.writeFileSync(path.join(claudeDir, 'settings.local.json'), '{}');

      const results = findSettingsFiles(deep, os.homedir(), 'project');
      expect(results).toContain(path.join(claudeDir, 'settings.json'));
      expect(results).toContain(path.join(claudeDir, 'settings.local.json'));
    } finally {
      rmTmp(tmp);
    }
  });

  it('returns [] when no settings files exist anywhere', () => {
    const tmp = mkTmp();
    try {
      const results = findSettingsFiles(tmp, tmp, 'all');
      expect(results).toEqual([]);
    } finally {
      rmTmp(tmp);
    }
  });
});

describe('scanFile', () => {
  it('records parseError for invalid JSON (does not throw)', () => {
    const tmp = mkTmp();
    try {
      const p = path.join(tmp, 'settings.json');
      fs.writeFileSync(p, '{ not valid json');
      const report = scanFile(p, resolverYes);
      expect(report.parseError).toMatch(/invalid JSON/);
      expect(report.findings).toEqual([]);
    } finally {
      rmTmp(tmp);
    }
  });

  it('finds broken-absolute and proposes PATH-resolved fix when claude-recall available', () => {
    const tmp = mkTmp();
    try {
      const p = path.join(tmp, 'settings.json');
      const settings = {
        hooksVersion: '6.0.0',
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node /home/openclaw/node_modules/claude-recall/dist/cli/claude-recall-cli.js hook run memory-stop',
                  timeout: 30,
                },
              ],
            },
          ],
        },
      };
      fs.writeFileSync(p, JSON.stringify(settings));

      const report = scanFile(p, resolverYes);
      expect(report.hooksVersion).toBe('6.0.0');
      expect(report.findings).toHaveLength(1);
      const f = report.findings[0];
      expect(f.classification.status).toBe('broken-absolute');
      expect(f.proposedCommand).toBe('claude-recall hook run memory-stop');
    } finally {
      rmTmp(tmp);
    }
  });

  it('leaves no proposedCommand when claude-recall is NOT on PATH', () => {
    const tmp = mkTmp();
    try {
      const p = path.join(tmp, 'settings.json');
      fs.writeFileSync(p, JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'node /missing/claude-recall-cli.js hook run memory-stop' }] }],
        },
      }));
      const report = scanFile(p, resolverNo);
      expect(report.findings[0].classification.status).toBe('broken-absolute');
      expect(report.findings[0].proposedCommand).toBeUndefined();
    } finally {
      rmTmp(tmp);
    }
  });

  it('ignores non-claude-recall hooks (e.g. python3 search_enforcer.py)', () => {
    const tmp = mkTmp();
    try {
      const p = path.join(tmp, 'settings.json');
      fs.writeFileSync(p, JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: '.*',
            hooks: [{ type: 'command', command: 'python3 /home/u/.claude/hooks/search_enforcer.py' }],
          }],
        },
      }));
      const report = scanFile(p, resolverYes);
      expect(report.findings).toEqual([]);
    } finally {
      rmTmp(tmp);
    }
  });
});

describe('applyFixes', () => {
  it('rewrites only broken-absolute; preserves timeout, matcher, and sibling hooks', () => {
    const tmp = mkTmp();
    try {
      const p = path.join(tmp, 'settings.json');
      const siblingCmd = 'python3 /home/u/.claude/hooks/search_enforcer.py';
      const settings = {
        hooksVersion: '6.0.0',
        hooks: {
          PreToolUse: [
            {
              matcher: '.*',
              hooks: [
                { type: 'command', command: siblingCmd },
                {
                  type: 'command',
                  command: 'node /home/openclaw/node_modules/claude-recall/dist/cli/claude-recall-cli.js hook run rule-injector',
                  timeout: 5,
                },
              ],
            },
          ],
        },
      };
      fs.writeFileSync(p, JSON.stringify(settings));

      const report = scanFile(p, resolverYes);
      const { changed, applied, backupPath } = applyFixes(report, { dryRun: false });
      expect(changed).toBe(true);
      expect(applied).toBe(1);
      expect(backupPath).toBeTruthy();
      expect(fs.existsSync(backupPath!)).toBe(true);

      const written = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(written.hooksVersion).toBe('6.0.0'); // untouched
      const group = written.hooks.PreToolUse[0];
      expect(group.matcher).toBe('.*');
      expect(group.hooks[0].command).toBe(siblingCmd); // sibling preserved
      expect(group.hooks[1].command).toBe('claude-recall hook run rule-injector');
      expect(group.hooks[1].timeout).toBe(5); // timeout preserved
    } finally {
      rmTmp(tmp);
    }
  });

  it('dry-run writes nothing and returns no backup path', () => {
    const tmp = mkTmp();
    try {
      const p = path.join(tmp, 'settings.json');
      const original = {
        hooks: {
          Stop: [{
            hooks: [{
              type: 'command',
              command: 'node /missing/claude-recall-cli.js hook run memory-stop',
              timeout: 30,
            }],
          }],
        },
      };
      fs.writeFileSync(p, JSON.stringify(original));

      const report = scanFile(p, resolverYes);
      const { changed, applied, backupPath } = applyFixes(report, { dryRun: true });
      expect(changed).toBe(true);
      expect(applied).toBe(1);
      expect(backupPath).toBeNull();

      const afterDryRun = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(afterDryRun).toEqual(original);
      // no backup files
      expect(fs.readdirSync(tmp).filter(n => n.startsWith('settings.json.bak')))
        .toEqual([]);
    } finally {
      rmTmp(tmp);
    }
  });
});

describe('runRepair', () => {
  function makeLogger() {
    const messages: string[] = [];
    return {
      messages,
      logger: {
        log: (m: string) => messages.push(m),
        warn: (m: string) => messages.push(m),
      },
    };
  }

  it('no-op when no settings files exist', async () => {
    const tmp = mkTmp();
    try {
      const { logger, messages } = makeLogger();
      const result = await runRepair({
        auto: true, scope: 'all', cwd: tmp, home: tmp, logger,
        claudeRecallOnPath: resolverYes,
      });
      expect(result.exitCode).toBe(0);
      expect(result.filesScanned).toBe(0);
      expect(result.filesModified).toBe(0);
      expect(messages.join('\n')).toMatch(/No settings files found/);
    } finally {
      rmTmp(tmp);
    }
  });

  it('applies safe fixes in --auto mode without prompting', async () => {
    const tmp = mkTmp();
    try {
      const claudeDir = path.join(tmp, '.claude');
      fs.mkdirSync(claudeDir);
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooksVersion: '6.0.0',
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'node /gone/claude-recall-cli.js hook run memory-stop', timeout: 30 }] }],
        },
      }));

      const { logger } = makeLogger();
      const result = await runRepair({
        auto: true, scope: 'user', home: tmp, cwd: '/not-used', logger,
        claudeRecallOnPath: resolverYes,
      });
      expect(result.exitCode).toBe(0);
      expect(result.filesModified).toBe(1);
      expect(result.fixesApplied).toBe(1);

      const written = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(written.hooks.Stop[0].hooks[0].command).toBe('claude-recall hook run memory-stop');
      expect(written.hooks.Stop[0].hooks[0].timeout).toBe(30);
      expect(written.hooksVersion).toBe('6.0.0'); // conservative: unchanged
    } finally {
      rmTmp(tmp);
    }
  });

  it('reports unfixable issues without exiting non-zero (postinstall safety)', async () => {
    const tmp = mkTmp();
    try {
      const claudeDir = path.join(tmp, '.claude');
      fs.mkdirSync(claudeDir);
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'node /gone/claude-recall-cli.js hook run memory-stop' }] }],
        },
      }));

      const { logger, messages } = makeLogger();
      const result = await runRepair({
        auto: true, scope: 'user', home: tmp, logger,
        claudeRecallOnPath: resolverNo, // no binary on PATH → can't fix
      });
      expect(result.exitCode).toBe(0);
      expect(result.filesModified).toBe(0);
      expect(result.unfixable).toBe(1);
      expect(messages.join('\n')).toMatch(/npm install -g claude-recall/);

      // File unchanged
      const afterRun = fs.readFileSync(settingsPath, 'utf8');
      expect(afterRun).toMatch('hook run memory-stop');
    } finally {
      rmTmp(tmp);
    }
  });

  it('does not create hooks where none exist', async () => {
    const tmp = mkTmp();
    try {
      // No .claude directory at all
      const { logger } = makeLogger();
      const result = await runRepair({
        auto: true, scope: 'all', home: tmp, cwd: tmp, logger,
        claudeRecallOnPath: resolverYes,
      });
      expect(result.exitCode).toBe(0);
      expect(result.filesScanned).toBe(0);
      expect(fs.existsSync(path.join(tmp, '.claude'))).toBe(false);
    } finally {
      rmTmp(tmp);
    }
  });

  it('handles malformed settings.json gracefully and exits 0', async () => {
    const tmp = mkTmp();
    try {
      const claudeDir = path.join(tmp, '.claude');
      fs.mkdirSync(claudeDir);
      fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{ invalid');

      const { logger, messages } = makeLogger();
      const result = await runRepair({
        auto: true, scope: 'user', home: tmp, logger,
        claudeRecallOnPath: resolverYes,
      });
      expect(result.exitCode).toBe(0);
      expect(messages.join('\n')).toMatch(/invalid JSON/);
    } finally {
      rmTmp(tmp);
    }
  });
});
