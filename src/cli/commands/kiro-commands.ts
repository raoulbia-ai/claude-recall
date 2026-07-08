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
  /** The claude-recall mcpServers entry (shared by fresh config and merge). */
  static buildMcpServerEntry(mcpCommand: string, mcpArgs: string[]): Record<string, unknown> {
    return {
      command: mcpCommand,
      args: mcpArgs,
      timeout: 120000,
    };
  }

  /** Read-only memory tools that run without prompting; store/delete still ask. */
  static readonly ALLOWED_TOOLS = [
    '@claude-recall/load_rules',
    '@claude-recall/search_memory',
    '@claude-recall/load_checkpoint',
  ];

  /** The four lifecycle hook entries (shared by fresh config and merge). */
  static buildHookEntries(hookCmd: string): Record<string, Array<Record<string, unknown>>> {
    return {
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
    };
  }

  static buildAgentConfig(hookCmd: string, mcpCommand: string, mcpArgs: string[]): Record<string, unknown> {
    return {
      name: 'recall',
      description: 'Kiro agent with Claude Recall persistent memory: rules auto-loaded at start, just-in-time injection per tool call, automatic capture of corrections and outcomes.',
      // Also load any servers the user configured in .kiro/settings/mcp.json
      includeMcpJson: true,
      mcpServers: {
        'claude-recall': KiroCommands.buildMcpServerEntry(mcpCommand, mcpArgs),
      },
      tools: ['*'],
      allowedTools: [...KiroCommands.ALLOWED_TOOLS],
      hooks: KiroCommands.buildHookEntries(hookCmd),
    };
  }

  /**
   * Merge claude-recall into an EXISTING agent config, append-don't-replace:
   *   - mcpServers.claude-recall added only if absent (never overwrites)
   *   - allowedTools entries appended, deduplicated
   *   - hook entries appended per lifecycle array, skipped when an entry for
   *     the same claude-recall handler is already present (idempotent)
   *   - an explicit `tools` list (no '*') gains '@claude-recall'
   * Returns a summary of what changed; mutates `config` in place.
   */
  static mergeIntoAgentConfig(
    config: Record<string, any>,
    hookCmd: string,
    mcpCommand: string,
    mcpArgs: string[],
  ): string[] {
    const changes: string[] = [];

    // mcpServers
    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      config.mcpServers = {};
    }
    if (config.mcpServers['claude-recall']) {
      changes.push('mcpServers.claude-recall: already present — left untouched');
    } else {
      config.mcpServers['claude-recall'] = KiroCommands.buildMcpServerEntry(mcpCommand, mcpArgs);
      changes.push('mcpServers.claude-recall: added');
    }

    // allowedTools (dedup append)
    if (!Array.isArray(config.allowedTools)) {
      config.allowedTools = [];
    }
    const addedTools = KiroCommands.ALLOWED_TOOLS.filter(t => !config.allowedTools.includes(t));
    config.allowedTools.push(...addedTools);
    changes.push(addedTools.length > 0
      ? `allowedTools: added ${addedTools.join(', ')}`
      : 'allowedTools: already present — nothing added');

    // tools: only when the agent restricts tools with an explicit list.
    // '*' or '@claude-recall' already grants access; an absent field is left
    // alone (the agent's default tool policy governs).
    if (Array.isArray(config.tools) && !config.tools.includes('*') && !config.tools.includes('@claude-recall')) {
      config.tools.push('@claude-recall');
      changes.push('tools: added @claude-recall (explicit tool list detected)');
    }

    // hooks (append per lifecycle; skip when our handler is already wired)
    if (!config.hooks || typeof config.hooks !== 'object') {
      config.hooks = {};
    }
    const handlerMarkers: Record<string, string> = {
      agentSpawn: 'kiro-agent-spawn',
      userPromptSubmit: 'correction-detector',
      preToolUse: 'kiro-rule-injector',
      postToolUse: 'kiro-tool-outcome',
    };
    for (const [event, entries] of Object.entries(KiroCommands.buildHookEntries(hookCmd))) {
      if (!Array.isArray(config.hooks[event])) {
        config.hooks[event] = [];
      }
      const marker = handlerMarkers[event];
      const alreadyWired = config.hooks[event].some(
        (h: any) => typeof h?.command === 'string' && h.command.includes(marker),
      );
      if (alreadyWired) {
        changes.push(`hooks.${event}: ${marker} already wired — skipped`);
      } else {
        config.hooks[event].push(...entries);
        changes.push(`hooks.${event}: added ${marker}`);
      }
    }

    return changes;
  }

  /** Resolve hook/MCP command forms (portable PATH form, absolute fallback). */
  private static resolveCommands(): { hookCmd: string; mcpCommand: string; mcpArgs: string[]; onPath: boolean } {
    const onPath = resolveOnPath('claude-recall');
    const cliScript = path.resolve(__dirname, '..', 'claude-recall-cli.js');
    return {
      onPath: !!onPath,
      hookCmd: onPath ? 'claude-recall hook run' : `node ${cliScript} hook run`,
      mcpCommand: onPath ? 'claude-recall' : 'node',
      mcpArgs: onPath ? ['mcp', 'start'] : [cliScript, 'mcp', 'start'],
    };
  }

  /**
   * Merge claude-recall into an existing agent config file. Lookup follows
   * Kiro's own precedence: workspace .kiro/agents first, then ~/.kiro/agents
   * (--global restricts to the global directory). Fail-safe: a missing agent
   * or malformed JSON changes nothing and exits 1; a timestamped backup is
   * written before any mutation.
   */
  static runMergeInto(agentName: string, options: { global?: boolean }): void {
    const safeName = agentName.replace(/\.json$/, '');
    const candidates = options.global
      ? [path.join(os.homedir(), '.kiro', 'agents', `${safeName}.json`)]
      : [
          path.join(process.cwd(), '.kiro', 'agents', `${safeName}.json`),
          path.join(os.homedir(), '.kiro', 'agents', `${safeName}.json`),
        ];

    const agentPath = candidates.find(p => fs.existsSync(p));
    if (!agentPath) {
      console.error(`❌ Agent "${safeName}" not found. Looked in:`);
      for (const p of candidates) console.error(`   ${p}`);
      console.error('   (workspace agents take precedence; use --global to target ~/.kiro/agents only)');
      process.exit(1);
    }

    const raw = fs.readFileSync(agentPath, 'utf8');
    let config: Record<string, any>;
    try {
      config = JSON.parse(raw);
    } catch {
      console.error(`❌ ${agentPath} is not valid JSON — refusing to modify it.`);
      console.error('   Fix the file (or recreate the agent) and re-run.');
      process.exit(1);
      return; // unreachable; satisfies control-flow analysis
    }

    const { hookCmd, mcpCommand, mcpArgs, onPath } = KiroCommands.resolveCommands();
    if (!onPath) {
      console.log('⚠️  claude-recall not on PATH — merged commands will use absolute paths (breaks if the install moves).');
    }

    // Structural change detection — the summary strings are for humans
    const before = JSON.stringify(config);
    const changes = KiroCommands.mergeIntoAgentConfig(config, hookCmd, mcpCommand, mcpArgs);
    const changed = JSON.stringify(config) !== before;

    if (!changed) {
      console.log(`✅ ${agentPath} already has Claude Recall fully wired — nothing to do.`);
      process.exit(0);
    }

    const backupPath = `${agentPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.writeFileSync(backupPath, raw);
    fs.writeFileSync(agentPath, JSON.stringify(config, null, 2) + '\n');

    console.log(`✅ Merged Claude Recall into: ${agentPath}`);
    console.log(`   Backup: ${backupPath}`);
    console.log('');
    for (const c of changes) console.log(`   • ${c}`);
    console.log('');
    console.log('Kiro hot-reloads agent configs on save — the changes apply to your next');
    console.log(`interaction with the "${safeName}" agent, no restart needed.`);
    process.exit(0);
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
    const { hookCmd, mcpCommand, mcpArgs, onPath } = KiroCommands.resolveCommands();
    if (!onPath) {
      console.log('⚠️  claude-recall not on PATH — the agent config will use absolute paths (breaks if the install moves).');
      console.log('   `npm install -g claude-recall` gives move-proof commands.');
    }

    fs.mkdirSync(baseDir, { recursive: true });
    const config = KiroCommands.buildAgentConfig(hookCmd, mcpCommand, mcpArgs);
    fs.writeFileSync(agentPath, JSON.stringify(config, null, 2) + '\n');

    console.log(`✅ Wrote Kiro agent config: ${agentPath}`);
    console.log('');
    console.log('No mcp.json changes needed — the agent config carries its own claude-recall');
    console.log('MCP server entry (and includeMcpJson keeps your other servers working).');
    console.log('');
    console.log('1. Start Kiro from your shell:');
    console.log('');
    console.log('kiro');
    console.log('');
    console.log('2. Inside the Kiro chat, switch to the agent:');
    console.log('');
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
      .description('Write a Kiro custom agent (.kiro/agents/recall.json) with Claude Recall memory wired in, or merge into an existing agent')
      .option('--global', 'Target ~/.kiro/agents (all projects) instead of ./.kiro/agents')
      .option('--force', 'Overwrite an existing recall.json (ignored with --merge-into)')
      .option('--merge-into <agent>', 'Merge Claude Recall into an existing agent config instead of creating the "recall" agent (backup written first; append-only; idempotent)')
      .action((options) => {
        if (options.mergeInto) {
          KiroCommands.runMergeInto(options.mergeInto, { global: options.global });
        } else {
          KiroCommands.runSetup(options);
        }
      });
  }
}
