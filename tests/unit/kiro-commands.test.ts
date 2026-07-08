/**
 * Tests for `claude-recall kiro setup` — agent config generation and the
 * no-clobber write behavior.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KiroCommands } from '../../src/cli/commands/kiro-commands';

describe('KiroCommands.buildAgentConfig', () => {
  const config = KiroCommands.buildAgentConfig('claude-recall hook run', 'claude-recall', ['mcp', 'start']) as any;

  it('wires the MCP server with the portable binary form', () => {
    expect(config.mcpServers['claude-recall']).toEqual({
      command: 'claude-recall',
      args: ['mcp', 'start'],
      timeout: 120000,
    });
    expect(config.includeMcpJson).toBe(true);
  });

  it('auto-allows only the read-only memory tools', () => {
    expect(config.allowedTools).toContain('@claude-recall/load_rules');
    expect(config.allowedTools).toContain('@claude-recall/search_memory');
    expect(config.allowedTools).not.toContain('@claude-recall/store_memory');
    expect(config.allowedTools).not.toContain('@claude-recall/delete_memory');
  });

  it('wires all four lifecycle hooks with timeouts', () => {
    expect(config.hooks.agentSpawn[0].command).toBe('claude-recall hook run kiro-agent-spawn');
    expect(config.hooks.userPromptSubmit[0].command).toBe('claude-recall hook run correction-detector');
    expect(config.hooks.preToolUse[0]).toMatchObject({
      matcher: '*',
      command: 'claude-recall hook run kiro-rule-injector',
    });
    expect(config.hooks.postToolUse[0]).toMatchObject({
      matcher: '*',
      command: 'claude-recall hook run kiro-tool-outcome',
    });
    for (const entries of Object.values(config.hooks) as any[]) {
      for (const h of entries) {
        expect(h.timeout_ms).toBeGreaterThan(0);
      }
    }
  });

  it('supports the absolute-path fallback form', () => {
    const fallback = KiroCommands.buildAgentConfig(
      'node /opt/cli.js hook run', 'node', ['/opt/cli.js', 'mcp', 'start'],
    ) as any;
    expect(fallback.mcpServers['claude-recall'].command).toBe('node');
    expect(fallback.mcpServers['claude-recall'].args).toEqual(['/opt/cli.js', 'mcp', 'start']);
    expect(fallback.hooks.agentSpawn[0].command).toContain('node /opt/cli.js hook run');
  });
});

describe('kiro setup command', () => {
  let tmpDir: string;
  let originalCwd: string;
  let exitSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-setup-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as any);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    logSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runSetup(options: { global?: boolean; force?: boolean } = {}): void {
    try {
      KiroCommands.runSetup(options);
    } catch (e: any) {
      if (e.message !== 'exit') throw e;
    }
  }

  it('writes .kiro/agents/recall.json in the current project', () => {
    runSetup({});

    const agentPath = path.join(tmpDir, '.kiro', 'agents', 'recall.json');
    expect(fs.existsSync(agentPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
    expect(written.name).toBe('recall');
    expect(written.hooks.agentSpawn[0].command).toContain('kiro-agent-spawn');
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does not clobber an existing config without --force', () => {
    const agentDir = path.join(tmpDir, '.kiro', 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    const agentPath = path.join(agentDir, 'recall.json');
    fs.writeFileSync(agentPath, '{"name":"user-customized"}');

    runSetup({});

    expect(fs.readFileSync(agentPath, 'utf8')).toBe('{"name":"user-customized"}');
  });

  it('overwrites with --force', () => {
    const agentDir = path.join(tmpDir, '.kiro', 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    const agentPath = path.join(agentDir, 'recall.json');
    fs.writeFileSync(agentPath, '{"name":"user-customized"}');

    runSetup({ force: true });

    const written = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
    expect(written.name).toBe('recall');
  });
});

describe('kiro setup --merge-into', () => {
  let tmpDir: string;
  let originalCwd: string;
  let exitSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-merge-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as any);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(originalCwd);
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgent(name: string, config: any): string {
    const dir = path.join(tmpDir, '.kiro', 'agents');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${name}.json`);
    fs.writeFileSync(p, JSON.stringify(config, null, 2));
    return p;
  }

  function runMerge(agent: string, options: { global?: boolean } = {}): void {
    try {
      KiroCommands.runMergeInto(agent, options);
    } catch (e: any) {
      if (e.message !== 'exit') throw e;
    }
  }

  it('merges all pieces into an existing agent, preserving its own config', () => {
    const agentPath = writeAgent('mcp-agent-env', {
      name: 'mcp-agent-env',
      description: 'Ericsson MCP servers',
      mcpServers: { jira: { command: 'jira-mcp', args: [] } },
      allowedTools: ['@jira/get_issue'],
      hooks: { agentSpawn: [{ command: 'git status' }] },
    });

    runMerge('mcp-agent-env');

    const merged = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
    // Own config preserved
    expect(merged.mcpServers.jira).toEqual({ command: 'jira-mcp', args: [] });
    expect(merged.allowedTools).toContain('@jira/get_issue');
    expect(merged.hooks.agentSpawn[0].command).toBe('git status');
    // Recall pieces appended
    expect(merged.mcpServers['claude-recall']).toBeDefined();
    expect(merged.allowedTools).toContain('@claude-recall/load_rules');
    expect(merged.hooks.agentSpawn.some((h: any) => h.command.includes('kiro-agent-spawn'))).toBe(true);
    expect(merged.hooks.userPromptSubmit.some((h: any) => h.command.includes('correction-detector'))).toBe(true);
    expect(merged.hooks.preToolUse.some((h: any) => h.command.includes('kiro-rule-injector'))).toBe(true);
    expect(merged.hooks.postToolUse.some((h: any) => h.command.includes('kiro-tool-outcome'))).toBe(true);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('writes a backup before mutating', () => {
    writeAgent('a1', { name: 'a1' });
    runMerge('a1');

    const dir = path.join(tmpDir, '.kiro', 'agents');
    const backups = fs.readdirSync(dir).filter(f => f.startsWith('a1.json.bak.'));
    expect(backups).toHaveLength(1);
    const backup = JSON.parse(fs.readFileSync(path.join(dir, backups[0]), 'utf8'));
    expect(backup).toEqual({ name: 'a1' }); // pre-merge content
  });

  it('is idempotent — second run changes nothing and writes no second backup', () => {
    const agentPath = writeAgent('a2', { name: 'a2' });
    runMerge('a2');
    const afterFirst = fs.readFileSync(agentPath, 'utf8');

    runMerge('a2');

    expect(fs.readFileSync(agentPath, 'utf8')).toBe(afterFirst);
    const dir = path.join(tmpDir, '.kiro', 'agents');
    expect(fs.readdirSync(dir).filter(f => f.startsWith('a2.json.bak.'))).toHaveLength(1);
    // No duplicate hooks
    const merged = JSON.parse(afterFirst);
    expect(merged.hooks.preToolUse.filter((h: any) => h.command.includes('kiro-rule-injector'))).toHaveLength(1);
  });

  it('adds @claude-recall to an explicit tools list but leaves "*" and absent alone', () => {
    const explicitPath = writeAgent('explicit', { name: 'explicit', tools: ['read', '@jira'] });
    runMerge('explicit');
    expect(JSON.parse(fs.readFileSync(explicitPath, 'utf8')).tools).toContain('@claude-recall');

    const wildcardPath = writeAgent('wildcard', { name: 'wildcard', tools: ['*'] });
    runMerge('wildcard');
    expect(JSON.parse(fs.readFileSync(wildcardPath, 'utf8')).tools).toEqual(['*']);

    const absentPath = writeAgent('absent', { name: 'absent' });
    runMerge('absent');
    expect(JSON.parse(fs.readFileSync(absentPath, 'utf8')).tools).toBeUndefined();
  });

  it('accepts the agent name with a .json suffix', () => {
    const agentPath = writeAgent('suffixed', { name: 'suffixed' });
    runMerge('suffixed.json');
    expect(JSON.parse(fs.readFileSync(agentPath, 'utf8')).mcpServers['claude-recall']).toBeDefined();
  });

  it('exits 1 without changes when the agent does not exist', () => {
    runMerge('nope');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy.mock.calls.flat().join('\n')).toContain('not found');
  });

  it('refuses to modify malformed JSON', () => {
    const dir = path.join(tmpDir, '.kiro', 'agents');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'broken.json');
    fs.writeFileSync(p, '{ not json');

    runMerge('broken');

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fs.readFileSync(p, 'utf8')).toBe('{ not json'); // untouched
    expect(fs.readdirSync(dir).filter(f => f.includes('.bak.'))).toHaveLength(0);
  });
});

describe('KiroCommands.inspectAgent', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiro-inspect-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function write(config: any): string {
    const p = path.join(tmpDir, 'a.json');
    fs.writeFileSync(p, JSON.stringify(config));
    return p;
  }

  it('reports MCP + which hooks are wired', () => {
    const info = KiroCommands.inspectAgent(write({
      name: 'mcp-agent-env',
      mcpServers: { 'claude-recall': {}, jira: {} },
      hooks: {
        agentSpawn: [{ command: 'claude-recall hook run kiro-agent-spawn' }],
        userPromptSubmit: [{ command: 'claude-recall hook run correction-detector' }],
        preToolUse: [{ command: 'other-tool' }],
      },
    }));
    expect(info).not.toBeNull();
    expect(info!.name).toBe('mcp-agent-env');
    expect(info!.mcp).toBe(true);
    expect(info!.hooks).toEqual(['agentSpawn', 'userPromptSubmit']);
  });

  it('reports not-wired for an agent without claude-recall', () => {
    const info = KiroCommands.inspectAgent(write({ name: 'plain', mcpServers: { jira: {} }, hooks: { agentSpawn: [{ command: 'git status' }] } }));
    expect(info!.mcp).toBe(false);
    expect(info!.hooks).toEqual([]);
  });

  it('returns null for malformed JSON or missing file', () => {
    const p = path.join(tmpDir, 'broken.json');
    fs.writeFileSync(p, '{ nope');
    expect(KiroCommands.inspectAgent(p)).toBeNull();
    expect(KiroCommands.inspectAgent(path.join(tmpDir, 'nonexistent.json'))).toBeNull();
  });
});
