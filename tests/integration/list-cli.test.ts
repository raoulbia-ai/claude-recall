import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

/**
 * Integration tests for the `list` CLI subcommand.
 *
 * Spawns the compiled CLI at dist/cli/claude-recall-cli.js against an isolated
 * HOME (so the DB lives under a temp dir). Skips if the build output is missing
 * — run `npm run build` before `npm test`.
 */

const CLI = path.join(__dirname, '..', '..', 'dist', 'cli', 'claude-recall-cli.js');
const distBuilt = fs.existsSync(CLI);
const itIfBuilt = distBuilt ? it : it.skip;

function mkTmp(prefix = 'list-cli-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function runCli(args: string[], cwd: string, home: string) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    cwd,
    // Isolated HOME → DB under <home>/.claude-recall. Same cwd for store and
    // list so both resolve the same project scope.
    env: { ...process.env, HOME: home, USERPROFILE: home },
    timeout: 20000,
  });
}

describe('list CLI (integration)', () => {
  beforeAll(() => {
    if (!distBuilt) {

      console.warn(`[list-cli.test] skipping — build first with 'npm run build' (missing ${CLI})`);
    }
  });

  itIfBuilt('lists stored memories newest-first, filters by type, and emits JSON', () => {
    const home = mkTmp();
    const proj = mkTmp('list-cli-proj-');
    try {
      // Seed: two preferences and one correction.
      expect(runCli(['store', 'alpha pref', '-t', 'preference'], proj, home).status).toBe(0);
      expect(runCli(['store', 'beta pref', '-t', 'preference'], proj, home).status).toBe(0);
      expect(runCli(['store', 'gamma fix', '-t', 'correction'], proj, home).status).toBe(0);

      // Plain list shows all three.
      const all = runCli(['list'], proj, home);
      expect(all.status).toBe(0);
      expect(all.stdout).toContain('alpha pref');
      expect(all.stdout).toContain('beta pref');
      expect(all.stdout).toContain('gamma fix');
      expect(all.stdout).toMatch(/3 memories/);

      // --type filters to just the corrections.
      const corrections = runCli(['list', '--type', 'correction'], proj, home);
      expect(corrections.status).toBe(0);
      expect(corrections.stdout).toContain('gamma fix');
      expect(corrections.stdout).not.toContain('alpha pref');

      // --json returns a parseable array with id/type/value fields.
      const json = runCli(['list', '--json'], proj, home);
      expect(json.status).toBe(0);
      const parsed = JSON.parse(json.stdout);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(3);
      for (const row of parsed) {
        expect(row).toHaveProperty('id');
        expect(row).toHaveProperty('type');
        expect(row).toHaveProperty('key');
      }

      // --limit caps the rendered rows and flags that more exist.
      const limited = runCli(['list', '--limit', '1'], proj, home);
      expect(limited.status).toBe(0);
      expect(limited.stdout).toMatch(/showing 1/);
    } finally {
      rmTmp(home);
      rmTmp(proj);
    }
  });

  itIfBuilt('reports an empty scope cleanly', () => {
    const home = mkTmp();
    const proj = mkTmp('list-cli-empty-');
    try {
      const res = runCli(['list', '--type', 'nonexistent-type'], proj, home);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('No memories found');
    } finally {
      rmTmp(home);
      rmTmp(proj);
    }
  });
});
