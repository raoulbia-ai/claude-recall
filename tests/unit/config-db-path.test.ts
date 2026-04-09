import * as path from 'path';

/**
 * Fix 4 — getDatabasePath ignores CLAUDE_RECALL_DB_PATH env var.
 *
 * Pre-fix bug: ConfigService.getDatabasePath() returned a hardcoded
 * `~/.claude-recall/claude-recall.db` regardless of the env var. Tests that
 * set CLAUDE_RECALL_DB_PATH to isolate from production silently wrote to
 * the production DB anyway, polluting it with test fixtures.
 *
 * Post-fix contract:
 *   - getDatabasePath() honors CLAUDE_RECALL_DB_PATH (used as the directory)
 *   - getDatabasePath() honors CLAUDE_RECALL_DB_NAME (used as the filename)
 *   - Defaults are unchanged when neither env var is set.
 */
describe('ConfigService.getDatabasePath — honors env vars', () => {
  const originalDbPath = process.env.CLAUDE_RECALL_DB_PATH;
  const originalDbName = process.env.CLAUDE_RECALL_DB_NAME;

  afterEach(() => {
    if (originalDbPath === undefined) delete process.env.CLAUDE_RECALL_DB_PATH;
    else process.env.CLAUDE_RECALL_DB_PATH = originalDbPath;
    if (originalDbName === undefined) delete process.env.CLAUDE_RECALL_DB_NAME;
    else process.env.CLAUDE_RECALL_DB_NAME = originalDbName;
    // Force re-init on next test
    jest.resetModules();
  });

  it('uses CLAUDE_RECALL_DB_PATH for the directory', () => {
    process.env.CLAUDE_RECALL_DB_PATH = '/tmp/cr-test-dbpath-xyz';
    delete process.env.CLAUDE_RECALL_DB_NAME;
    jest.resetModules();
    const { ConfigService } = require('../../src/services/config');
    (ConfigService as any).instance = undefined;
    const cfg = ConfigService.getInstance();
    const dbPath = cfg.getDatabasePath();
    expect(dbPath.startsWith('/tmp/cr-test-dbpath-xyz')).toBe(true);
  });

  it('uses CLAUDE_RECALL_DB_NAME for the filename', () => {
    process.env.CLAUDE_RECALL_DB_PATH = '/tmp/cr-test-dbname-xyz';
    process.env.CLAUDE_RECALL_DB_NAME = 'custom.db';
    jest.resetModules();
    const { ConfigService } = require('../../src/services/config');
    (ConfigService as any).instance = undefined;
    const cfg = ConfigService.getInstance();
    const dbPath = cfg.getDatabasePath();
    expect(path.basename(dbPath)).toBe('custom.db');
    expect(dbPath).toBe(path.join('/tmp/cr-test-dbname-xyz', 'custom.db'));
  });

  it('falls back to default location when no env vars set', () => {
    delete process.env.CLAUDE_RECALL_DB_PATH;
    delete process.env.CLAUDE_RECALL_DB_NAME;
    jest.resetModules();
    const { ConfigService } = require('../../src/services/config');
    (ConfigService as any).instance = undefined;
    const cfg = ConfigService.getInstance();
    const dbPath = cfg.getDatabasePath();
    expect(dbPath.endsWith('/.claude-recall/claude-recall.db')).toBe(true);
  });
});
