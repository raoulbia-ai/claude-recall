import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

/**
 * Integration tests for `setup --install` scope handling (project vs --global).
 * Spawns the compiled CLI; skips if dist is not built.
 */

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli', 'claude-recall-cli.js');
const distBuilt = fs.existsSync(CLI);
const itIfBuilt = distBuilt ? it : it.skip;

function mkTmp(prefix = 'setup-cli-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
function runCli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', cwd: opts.cwd, env: opts.env ?? process.env, timeout: 20000,
  });
}
function crHookCount(settingsPath: string): { total: number; orphanProne: number } {
  const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  let total = 0, orphanProne = 0;
  for (const groups of Object.values<any>(s.hooks || {})) {
    for (const g of groups) for (const h of (g.hooks || [])) {
      if (/claude-recall/.test(h.command)) total++;
      if (/\/versions\/node\/v/.test(h.command)) orphanProne++;
    }
  }
  return { total, orphanProne };
}

describe('setup --install scope (integration)', () => {
  beforeAll(() => {
    if (!distBuilt) console.warn(`[setup-cli.test] skipping — build first (missing ${CLI})`);
  });

  itIfBuilt('--global installs hooks into ~/.claude (active in every project)', () => {
    const tmpHome = mkTmp();
    try {
      const res = runCli(['setup', '--install', '--global'], { env: { ...process.env, HOME: tmpHome } });
      expect(res.stdout).toMatch(/global/i);

      const settingsPath = path.join(tmpHome, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const { total, orphanProne } = crHookCount(settingsPath);
      expect(total).toBeGreaterThan(0);
      // Hooks must use the portable PATH form, never an absolute node-version
      // path (that's the orphan-on-node-switch failure class).
      expect(orphanProne).toBe(0);

      // Enforcer + skills land under the global .claude too.
      expect(fs.existsSync(path.join(tmpHome, '.claude', 'hooks', 'search_enforcer.py'))).toBe(true);
    } finally { rmTmp(tmpHome); }
  });

  itIfBuilt('without --global installs into the project, not ~/.claude', () => {
    const tmpHome = mkTmp();
    const tmpProject = mkTmp('setup-proj-');
    try {
      runCli(['setup', '--install'], { cwd: tmpProject, env: { ...process.env, HOME: tmpHome } });

      // Project scope written…
      const projSettings = path.join(tmpProject, '.claude', 'settings.json');
      expect(fs.existsSync(projSettings)).toBe(true);
      expect(crHookCount(projSettings).total).toBeGreaterThan(0);

      // …and the user-global settings untouched (not created by a project install).
      expect(fs.existsSync(path.join(tmpHome, '.claude', 'settings.json'))).toBe(false);
    } finally { rmTmp(tmpHome); rmTmp(tmpProject); }
  });
});
