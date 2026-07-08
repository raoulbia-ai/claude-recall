// Type-only: commander 15 is ESM-only, and a runtime import here would break
// jest's CJS transform for any test importing this module. register() only
// needs the type; the Command instance is passed in by the CLI entry.
import type { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveOnPath } from './repair';

/**
 * Kiro CLI integration commands.
 *
 * `claude-recall kiro setup` writes a Kiro custom agent config
 * (.kiro/agents/recall.json) wiring the same shared memory database into
 * Kiro CLI: MCP tools, rules auto-loaded into context at agentSpawn,
 * just-in-time rule injection on preToolUse, user-prompt capture, and tool
 * outcome tracking. See src/hooks/kiro-hooks.ts for the adapter details and
 * kiro.dev/docs/cli/custom-agents for the config format.
 */
export class KiroCommands {
  static buildAgentConfig(hookCmd: string, mcpCommand: string, mcpArgs: string[]): Record<string, unknown> {
    return {
      name: 'recall',
      description: 'Kiro agent with Claude Recall persistent memory: rules auto-loaded at start, just-in-time injection per tool call, automatic capture of corrections and outcomes.',
      // Also load any servers the user configured in .kiro/settings/mcp.json
      includeMcpJson: true,
      mcpServers: {
        'claude-recall': {
          command: mcpCommand,
          args: mcpArgs,
          timeout: 120000,
        },
      },
      tools: ['*'],
      // Read-only memory tools run without prompting; store/delete still ask
      allowedTools: [
        '@claude-recall/load_rules',
        '@claude-recall/search_memory',
        '@claude-recall/load_checkpoint',
      ],
      hooks: {
        // stdout of agentSpawn is added to context → rules present from turn one
        agentSpawn: [
          { command: `${hookCmd} kiro-agent-spawn`, timeout_ms: 10000 },
        ],
        // Kiro's userPromptSubmit payload matches correction-detector exactly
        userPromptSubmit: [
          { command: `${hookCmd} correction-detector`, timeout_ms: 8000 },
        ],
        preToolUse: [
          { matcher: '*', command: `${hookCmd} kiro-rule-injector`, timeout_ms: 5000 },
        ],
        postToolUse: [
          { matcher: '*', command: `${hookCmd} kiro-tool-outcome`, timeout_ms: 5000 },
        ],
      },
    };
  }

  /** Action body, separated from commander wiring so tests can call it directly. */
  static runSetup(options: { global?: boolean; force?: boolean }): void {
    const baseDir = options.global
      ? path.join(os.homedir(), '.kiro', 'agents')
      : path.join(process.cwd(), '.kiro', 'agents');
    const agentPath = path.join(baseDir, 'recall.json');

    if (fs.existsSync(agentPath) && !options.force) {
      console.log(`✅ ${agentPath} already exists — leaving it untouched (use --force to overwrite).`);
      process.exit(0);
    }

    // Prefer the portable PATH form; absolute dist path only as fallback
    // (same policy as Claude Code hook installation — move-proof commands)
    const onPath = resolveOnPath('claude-recall');
    const cliScript = path.resolve(__dirname, '..', 'claude-recall-cli.js');
    const hookCmd = onPath ? 'claude-recall hook run' : `node ${cliScript} hook run`;
    const mcpCommand = onPath ? 'claude-recall' : 'node';
    const mcpArgs = onPath ? ['mcp', 'start'] : [cliScript, 'mcp', 'start'];
    if (!onPath) {
      console.log('⚠️  claude-recall not on PATH — the agent config will use absolute paths (breaks if the install moves).');
      console.log('   `npm install -g claude-recall` gives move-proof commands.');
    }

    fs.mkdirSync(baseDir, { recursive: true });
    const config = KiroCommands.buildAgentConfig(hookCmd, mcpCommand, mcpArgs);
    fs.writeFileSync(agentPath, JSON.stringify(config, null, 2) + '\n');

    console.log(`✅ Wrote Kiro agent config: ${agentPath}`);
    console.log('');
    console.log('To use it, start Kiro CLI and switch to the agent:');
    console.log('');
    console.log('kiro');
    console.log('/agent swap recall');
    console.log('');
    console.log('Rules load into context automatically at agent start; corrections and');
    console.log('preferences you state are captured; memories are shared with Claude Code');
    console.log('(same database, same per-project scoping).');
    console.log('');
    console.log('Not available under Kiro: transcript-based failure detection and');
    console.log('session-end checkpoints (Kiro exposes no transcript to hooks).');
    process.exit(0);
  }

  static register(program: Command): void {
    const kiroCmd = program
      .command('kiro')
      .description('Kiro CLI integration');

    kiroCmd
      .command('setup')
      .description('Write a Kiro custom agent (.kiro/agents/recall.json) with Claude Recall memory wired in')
      .option('--global', 'Write to ~/.kiro/agents (all projects) instead of ./.kiro/agents')
      .option('--force', 'Overwrite an existing recall.json')
      .action((options) => {
        KiroCommands.runSetup(options);
      });
  }
}
