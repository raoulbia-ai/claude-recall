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
