import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

/**
 * Integration tests for the `repair` CLI subcommand.
 *
 * These tests spawn the compiled CLI at dist/cli/claude-recall-cli.js. If the
 * build output is missing they skip with a warning — run `npm run build`
 * before `npm test` to execute them.
 */

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli', 'claude-recall-cli.js');
const distBuilt = fs.existsSync(CLI);
const itIfBuilt = distBuilt ? it : it.skip;

function mkTmp(prefix = 'repair-cli-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runCli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  // Use process.execPath so PATH-scrubbed tests can still launch node.
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    timeout: 15000,
  });
}

describe('repair CLI (integration)', () => {
  beforeAll(() => {
    if (!distBuilt) {
      // eslint-disable-next-line no-console
      console.warn(`[repair-cli.test] skipping — build first with 'npm run build' (missing ${CLI})`);
    }
  });

  itIfBuilt('--dry-run reports fixable issues and leaves file unchanged', () => {
    const tmpHome = mkTmp();
    try {
      const claudeDir = path.join(tmpHome, '.claude');
      fs.mkdirSync(claudeDir);
      const settingsPath = path.join(claudeDir, 'settings.json');
      const original = {
        hooksVersion: '6.0.0',
        hooks: {
          Stop: [{
            hooks: [{
              type: 'command',
              command: 'node /does/not/exist/claude-recall-cli.js hook run memory-stop',
              timeout: 30,
            }],
          }],
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(original));

      const res = runCli(['repair', '--dry-run', '--auto', '--scope', 'user'], {
        env: { ...process.env, HOME: tmpHome },
      });
      expect(res.status).toBe(0);
      expect(res.stdout + res.stderr).toMatch(/broken-absolute|missing script|fixable/i);

      const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(after).toEqual(original);
      expect(fs.readdirSync(claudeDir).filter(n => n.startsWith('settings.json.bak')))
        .toEqual([]);
    } finally {
      rmTmp(tmpHome);
    }
  });

  itIfBuilt('--auto applies safe fixes when claude-recall is on PATH', () => {
    const tmpHome = mkTmp();
    const shimDir = mkTmp('repair-shim-');
    try {
      const claudeDir = path.join(tmpHome, '.claude');
      fs.mkdirSync(claudeDir);
      const settingsPath = path.join(claudeDir, 'settings.json');
      fs.writeFileSync(settingsPath, JSON.stringify({
        hooksVersion: '6.0.0',
        hooks: {
          Stop: [{
            hooks: [
              { type: 'command', command: 'python3 /tmp/some-other-hook.py' },
              {
                type: 'command',
                command: 'node /gone/claude-recall-cli.js hook run memory-stop',
                timeout: 30,
              },
            ],
          }],
        },
      }));

      // Fake `claude-recall` on PATH via a tiny shim in shimDir.
      const shimPath = path.join(shimDir, 'claude-recall');
      fs.writeFileSync(shimPath, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(shimPath, 0o755);

      const res = runCli(['repair', '--auto', '--scope', 'user'], {
        env: {
          ...process.env,
          HOME: tmpHome,
          PATH: `${shimDir}${path.delimiter}${process.env.PATH || ''}`,
        },
      });
      expect(res.status).toBe(0);

      const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const group = after.hooks.Stop[0];
      // sibling python hook untouched
      expect(group.hooks[0].command).toBe('python3 /tmp/some-other-hook.py');
      // broken absolute rewritten to PATH form, timeout preserved
      expect(group.hooks[1].command).toBe('claude-recall hook run memory-stop');
      expect(group.hooks[1].timeout).toBe(30);
      // hooksVersion untouched
      expect(after.hooksVersion).toBe('6.0.0');
      // backup written
      expect(fs.readdirSync(claudeDir).some(n => n.startsWith('settings.json.bak')))
        .toBe(true);
    } finally {
      rmTmp(tmpHome);
      rmTmp(shimDir);
    }
  });

  itIfBuilt('--auto exits 0 and reports when claude-recall is not on PATH', () => {
    const tmpHome = mkTmp();
    try {
      const claudeDir = path.join(tmpHome, '.claude');
      fs.mkdirSync(claudeDir);
      const settingsPath = path.join(claudeDir, 'settings.json');
      const original = {
        hooks: {
          Stop: [{ hooks: [{ type: 'command', command: 'node /gone/claude-recall-cli.js hook run memory-stop' }] }],
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(original));

      // Scrub PATH so claude-recall is not resolvable.
      const res = runCli(['repair', '--auto', '--scope', 'user'], {
        env: { ...process.env, HOME: tmpHome, PATH: '/nonexistent' },
      });
      expect(res.status).toBe(0);
      expect(res.stdout + res.stderr).toMatch(/npm install -g claude-recall|no safe fix/i);

      const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      expect(after).toEqual(original);
    } finally {
      rmTmp(tmpHome);
    }
  });

  itIfBuilt('no-op when no settings files exist under the home', () => {
    const tmpHome = mkTmp();
    try {
      const res = runCli(['repair', '--auto', '--scope', 'user'], {
        env: { ...process.env, HOME: tmpHome },
      });
      expect(res.status).toBe(0);
      expect(res.stdout + res.stderr).toMatch(/No settings files found/);
      expect(fs.existsSync(path.join(tmpHome, '.claude'))).toBe(false);
    } finally {
      rmTmp(tmpHome);
    }
  });

  itIfBuilt('rejects unknown --scope values', () => {
    const res = runCli(['repair', '--scope', 'bogus', '--auto']);
    expect(res.status).not.toBe(0);
    expect(res.stderr + res.stdout).toMatch(/Invalid --scope/);
  });
});
