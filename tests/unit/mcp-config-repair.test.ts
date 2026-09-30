import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  classifyMcpEntry,
  scanMcpConfig,
  applyMcpConsolidation,
  canonicalEntry,
  isCanonical,
  mcpConfigPath,
} from '../../src/cli/commands/mcp-config-repair';

// Real temp dirs on disk, injected as `home` — never touches the real ~/.claude.json.
function mkTmp(prefix = 'mcp-config-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function rmTmp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}
function writeConfig(home: string, obj: unknown): void {
  fs.writeFileSync(mcpConfigPath(home), JSON.stringify(obj, null, 2));
}
function readConfig(home: string): any {
  return JSON.parse(fs.readFileSync(mcpConfigPath(home), 'utf8'));
}

const binEntry = (env: Record<string, string> = {}) => ({
  type: 'stdio', command: 'claude-recall', args: ['mcp', 'start'], env,
});
const npxEntry = (env: Record<string, string> = {}) => ({
  type: 'stdio', command: 'npx', args: ['claude-recall', 'mcp', 'start'], env,
});

describe('classifyMcpEntry', () => {
  it('flags an npx launcher', () => {
    expect(classifyMcpEntry(npxEntry())).toEqual(['npx-launcher']);
  });

  it('flags an orphaned absolute command path that no longer exists', () => {
    expect(classifyMcpEntry({ command: '/home/u/.nvm/versions/node/v20.0.0/bin/claude-recall' }))
      .toEqual(['orphaned-binary']);
  });

  it('does not flag an absolute path that exists on disk', () => {
    expect(classifyMcpEntry({ command: process.execPath })).toEqual([]);
  });

  it('does not flag the canonical bare binary', () => {
    expect(classifyMcpEntry(binEntry())).toEqual([]);
  });
});

describe('isCanonical / canonicalEntry', () => {
  it('recognizes the canonical shape regardless of env', () => {
    expect(isCanonical(binEntry({ CLAUDE_RECALL_AUTO_DEMOTE: 'true' }))).toBe(true);
    expect(isCanonical(npxEntry())).toBe(false);
    expect(isCanonical({ command: 'claude-recall', args: ['mcp'] })).toBe(false);
  });

  it('builds a stdio binary entry preserving env', () => {
    expect(canonicalEntry({ A: '1' })).toEqual({
      type: 'stdio', command: 'claude-recall', args: ['mcp', 'start'], env: { A: '1' },
    });
  });
});

describe('scanMcpConfig', () => {
  it('reports absent file without throwing', () => {
    const home = mkTmp();
    try {
      const r = scanMcpConfig(home);
      expect(r.present).toBe(false);
      expect(r.needsConsolidation).toBe(false);
      expect(r.entryCount).toBe(0);
    } finally { rmTmp(home); }
  });

  it('reports malformed JSON without throwing', () => {
    const home = mkTmp();
    try {
      fs.writeFileSync(mcpConfigPath(home), '{ not json');
      const r = scanMcpConfig(home);
      expect(r.present).toBe(true);
      expect(r.parseError).toMatch(/invalid JSON/);
      expect(r.needsConsolidation).toBe(false);
    } finally { rmTmp(home); }
  });

  it('treats a single canonical user entry as healthy', () => {
    const home = mkTmp();
    try {
      writeConfig(home, { mcpServers: { 'claude-recall': binEntry({ CLAUDE_RECALL_AUTO_DEMOTE: 'true' }) } });
      const r = scanMcpConfig(home);
      expect(r.entryCount).toBe(1);
      expect(r.needsConsolidation).toBe(false);
      expect(r.findings[0].issues).toEqual([]);
    } finally { rmTmp(home); }
  });

  it('flags an npx user entry as needing consolidation', () => {
    const home = mkTmp();
    try {
      writeConfig(home, { mcpServers: { 'claude-recall': npxEntry() } });
      const r = scanMcpConfig(home);
      expect(r.needsConsolidation).toBe(true);
      expect(r.findings[0].issues).toContain('npx-launcher');
    } finally { rmTmp(home); }
  });

  it('detects duplicate project scopes and unions env', () => {
    const home = mkTmp();
    try {
      writeConfig(home, {
        mcpServers: { 'claude-recall': binEntry() },
        projects: {
          '/a': { mcpServers: { 'claude-recall': npxEntry({ CLAUDE_RECALL_AUTO_DEMOTE: 'true' }) } },
          '/b': { mcpServers: { 'claude-recall': binEntry({ CLAUDE_RECALL_AUTO_DEMOTE: 'true' }) } },
        },
      });
      const r = scanMcpConfig(home);
      expect(r.entryCount).toBe(3);
      expect(r.needsConsolidation).toBe(true);
      const projFindings = r.findings.filter(f => f.scope.kind === 'project');
      expect(projFindings.every(f => f.issues.includes('duplicate-scope'))).toBe(true);
      expect(r.mergedEnv).toEqual({ CLAUDE_RECALL_AUTO_DEMOTE: 'true' });
      expect(r.envConflicts).toEqual([]);
    } finally { rmTmp(home); }
  });

  it('records env conflicts across scopes instead of guessing', () => {
    const home = mkTmp();
    try {
      writeConfig(home, {
        mcpServers: { 'claude-recall': binEntry({ K: 'one' }) },
        projects: { '/a': { mcpServers: { 'claude-recall': binEntry({ K: 'two' }) } } },
      });
      const r = scanMcpConfig(home);
      expect(r.envConflicts).toEqual([{ key: 'K', values: expect.arrayContaining(['one', 'two']) }]);
    } finally { rmTmp(home); }
  });
});

describe('applyMcpConsolidation', () => {
  it('consolidates to a single user entry, removes duplicates, preserves env, backs up', () => {
    const home = mkTmp();
    try {
      writeConfig(home, {
        someOtherKey: 42,
        mcpServers: { 'claude-recall': npxEntry({ CLAUDE_RECALL_AUTO_DEMOTE: 'true' }), other: { command: 'x' } },
        projects: {
          '/a': { mcpServers: { 'claude-recall': npxEntry(), keepMe: { command: 'y' } }, history: [1] },
          '/b': { mcpServers: { 'claude-recall': binEntry() } },
        },
      });
      const before = scanMcpConfig(home);
      const res = applyMcpConsolidation(before, { home });

      expect(res.changed).toBe(true);
      expect(res.backupPath).toMatch(/\.claude\.json\.bak\./);
      expect(fs.existsSync(res.backupPath!)).toBe(true);
      expect(res.removed).toHaveLength(2);

      const after = readConfig(home);
      // canonical user entry with preserved env
      expect(after.mcpServers['claude-recall']).toEqual(binEntry({ CLAUDE_RECALL_AUTO_DEMOTE: 'true' }));
      // unrelated data preserved
      expect(after.someOtherKey).toBe(42);
      expect(after.mcpServers.other).toEqual({ command: 'x' });
      // a sibling MCP server in the same project scope is preserved
      expect(after.projects['/a'].mcpServers.keepMe).toEqual({ command: 'y' });
      expect(after.projects['/a'].history).toEqual([1]);
      // duplicates gone
      expect(after.projects['/a'].mcpServers['claude-recall']).toBeUndefined();
      expect(after.projects['/b'].mcpServers['claude-recall']).toBeUndefined();
    } finally { rmTmp(home); }
  });

  it('is idempotent — a second scan needs no consolidation and apply is a no-op', () => {
    const home = mkTmp();
    try {
      writeConfig(home, {
        mcpServers: { 'claude-recall': npxEntry() },
        projects: { '/a': { mcpServers: { 'claude-recall': npxEntry() } } },
      });
      applyMcpConsolidation(scanMcpConfig(home), { home });

      const rescan = scanMcpConfig(home);
      expect(rescan.needsConsolidation).toBe(false);
      const res2 = applyMcpConsolidation(rescan, { home });
      expect(res2.changed).toBe(false);
    } finally { rmTmp(home); }
  });

  it('refuses to consolidate on an env conflict and leaves the file unchanged', () => {
    const home = mkTmp();
    try {
      const cfg = {
        mcpServers: { 'claude-recall': binEntry({ K: 'one' }) },
        projects: { '/a': { mcpServers: { 'claude-recall': binEntry({ K: 'two' }) } } },
      };
      writeConfig(home, cfg);
      const raw = fs.readFileSync(mcpConfigPath(home), 'utf8');

      const res = applyMcpConsolidation(scanMcpConfig(home), { home });
      expect(res.changed).toBe(false);
      expect(res.blockedReason).toMatch(/conflicting env/);
      // byte-for-byte unchanged
      expect(fs.readFileSync(mcpConfigPath(home), 'utf8')).toBe(raw);
    } finally { rmTmp(home); }
  });

  it('dry-run reports the change but writes nothing', () => {
    const home = mkTmp();
    try {
      writeConfig(home, { mcpServers: { 'claude-recall': npxEntry() } });
      const raw = fs.readFileSync(mcpConfigPath(home), 'utf8');
      const res = applyMcpConsolidation(scanMcpConfig(home), { home, dryRun: true });
      expect(res.changed).toBe(true);
      expect(res.backupPath).toBeNull();
      expect(fs.readFileSync(mcpConfigPath(home), 'utf8')).toBe(raw);
    } finally { rmTmp(home); }
  });

  it('does nothing when there is no config file', () => {
    const home = mkTmp();
    try {
      const res = applyMcpConsolidation(scanMcpConfig(home), { home });
      expect(res.changed).toBe(false);
    } finally { rmTmp(home); }
  });
});
