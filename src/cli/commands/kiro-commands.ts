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

  /**
   * Name of the bare agent used for headless memory classification. Kept in
   * sync with CLASSIFIER_AGENT in src/hooks/kiro-classifier.ts (duplicated as a
   * plain string so this module doesn't pull the hooks graph into jest).
   */
  static readonly CLASSIFIER_AGENT_NAME = 'claude-recall-classifier';

  /** The bare classifier agent config — no MCP, no hooks, no tools. */
  static buildClassifierAgentConfig(): Record<string, unknown> {
    return {
      name: KiroCommands.CLASSIFIER_AGENT_NAME,
      description: 'Headless memory classifier for Claude Recall. No MCP servers, hooks, or tools — invoked by the capture worker to decide what to remember, using Kiro\'s own LLM.',
      mcpServers: {},
      includeMcpJson: false,
      tools: [],
      allowedTools: [],
      hooks: {},
    };
  }

  /**
   * Write the bare classifier agent to ~/.kiro/agents/ (always global, so any
   * project's capture worker can invoke `--agent claude-recall-classifier`).
   * Idempotent overwrite — the file is entirely ours. Returns its path.
   */
  static writeClassifierAgent(): string {
    const dir = path.join(os.homedir(), '.kiro', 'agents');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, `${KiroCommands.CLASSIFIER_AGENT_NAME}.json`);
    fs.writeFileSync(p, JSON.stringify(KiroCommands.buildClassifierAgentConfig(), null, 2) + '\n');
    return p;
  }

  /** The four lifecycle hook entries (shared by fresh config and merge). */
  static buildHookEntries(hookCmd: string): Record<string, Array<Record<string, unknown>>> {
    return {
      // stdout of agentSpawn is added to context → rules present from turn one
      agentSpawn: [
        { command: `${hookCmd} kiro-agent-spawn`, timeout_ms: 10000 },
      ],
      // Capture. kiro-capture spawns a detached worker that classifies the
      // prompt via Kiro's own headless LLM (no ANTHROPIC_API_KEY needed) and
      // stores in the background — see src/hooks/kiro-classifier.ts. The hook
      // itself returns in milliseconds, so the short timeout is ample.
      userPromptSubmit: [
        { command: `${hookCmd} kiro-capture`, timeout_ms: 8000 },
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
      userPromptSubmit: 'kiro-capture',
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

    // Capture uses Kiro's own headless LLM via a bare classifier agent.
    const classifierPath = KiroCommands.writeClassifierAgent();

    console.log(`✅ Merged Claude Recall into: ${agentPath}`);
    console.log(`   Backup: ${backupPath}`);
    console.log(`   Classifier agent: ${classifierPath}`);
    console.log('');
    for (const c of changes) console.log(`   • ${c}`);
    console.log('');
    console.log('⚠️  IMPORTANT — one-time rollover per project: Kiro snapshots the agent');
    console.log('config into each conversation AT CREATION, and --resume restores that');
    console.log('snapshot. Conversations created BEFORE this merge will never run the');
    console.log(`memory hooks. In each project, start ONE fresh conversation (no --resume):`);
    console.log('');
    console.log(`kiro-cli chat --agent ${safeName}`);
    console.log('');
    console.log('Every conversation created from now on carries the hooks — including');
    console.log('when resumed, so your normal --resume workflow works from then on.');
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

    // Capture uses Kiro's own headless LLM via a bare classifier agent.
    const classifierPath = KiroCommands.writeClassifierAgent();

    console.log(`✅ Wrote Kiro agent config: ${agentPath}`);
    console.log(`✅ Wrote classifier agent:  ${classifierPath}`);
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
    console.log('(same database, same per-project scoping). Capture classifies each prompt');
    console.log('with Kiro\'s own LLM — no ANTHROPIC_API_KEY needed (spends ~0.06 Kiro');
    console.log('credits/prompt; set CLAUDE_RECALL_KIRO_MODEL to change the model).');
    console.log('');
    console.log('⚠️  Kiro snapshots the agent config into each conversation at creation —');
    console.log('conversations created before this setup never run the hooks, even when');
    console.log('resumed. Start ONE fresh conversation (no --resume) per project; every');
    console.log('conversation from then on carries the hooks, including when resumed.');
    console.log('');
    console.log('Not available under Kiro: transcript-based failure detection and');
    console.log('session-end checkpoints (Kiro exposes no transcript to hooks).');
    process.exit(0);
  }

  /**
   * Read a Kiro agent config and report whether claude-recall is wired
   * (MCP server + which lifecycle hooks). Returns null if the file is missing
   * or unparseable.
   */
  static inspectAgent(agentPath: string): {
    name: string;
    mcp: boolean;
    hooks: string[];
  } | null {
    let config: any;
    try {
      config = JSON.parse(fs.readFileSync(agentPath, 'utf8'));
    } catch {
      return null;
    }
    const mcp = !!(config.mcpServers && config.mcpServers['claude-recall']);
    const hooks: string[] = [];
    if (config.hooks && typeof config.hooks === 'object') {
      for (const [event, entries] of Object.entries(config.hooks)) {
        if (Array.isArray(entries) && entries.some(
          (h: any) => typeof h?.command === 'string' && h.command.includes('claude-recall'),
        )) {
          hooks.push(event);
        }
      }
    }
    return { name: config.name || path.basename(agentPath, '.json'), mcp, hooks };
  }

  /** Last non-empty line of a hook log + how long ago, or null if none. */
  private static lastLogLine(logPath: string): { line: string; ageMs: number | null } | null {
    try {
      const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim());
      if (lines.length === 0) return null;
      const line = lines[lines.length - 1];
      const m = line.match(/^\[([^\]]+)\]/);
      let ageMs: number | null = null;
      if (m) {
        const t = Date.parse(m[1]);
        if (!Number.isNaN(t)) ageMs = Date.now() - t;
      }
      return { line, ageMs };
    } catch {
      return null;
    }
  }

  private static fmtAge(ageMs: number | null): string {
    if (ageMs === null) return '';
    const min = Math.round(ageMs / 60000);
    if (min < 1) return ' (just now)';
    if (min < 60) return ` (${min}m ago)`;
    const h = Math.round(min / 60);
    if (h < 48) return ` (${h}h ago)`;
    return ` (${Math.round(h / 24)}d ago)`;
  }

  /**
   * `claude-recall kiro doctor` — read-only diagnostic. Answers the questions
   * that otherwise take a support round-trip: is the binary current and on
   * PATH, is a key available for LLM capture, does the DB have memories, which
   * Kiro agents have claude-recall wired, and are the hooks actually firing.
   */
  static runDoctor(): void {
    const line = (marker: string, text: string) => console.log(`  ${marker} ${text}`);

    console.log('\n🩺 Claude Recall — Kiro diagnostic\n');

    // --- Install ---
    console.log('Install');
    let version = 'unknown';
    try {
      version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')).version;
    } catch { /* leave unknown */ }
    line('•', `version: ${version}`);
    const onPath = resolveOnPath('claude-recall');
    line(onPath ? '✓' : '⚠', onPath
      ? `on PATH: ${onPath}`
      : 'not on PATH — hooks/agent commands will use absolute paths (break if the install moves)');
    line(process.env.ANTHROPIC_API_KEY ? '✓' : '•', process.env.ANTHROPIC_API_KEY
      ? 'ANTHROPIC_API_KEY set — hooks use Claude Haiku for classification'
      : 'ANTHROPIC_API_KEY not set — hooks use the regex fallback (explicit "remember/recall/always/never/I prefer …" still captured)');

    // --- Database ---
    console.log('\nDatabase (this project)');
    try {
      // Lazy require so a broken DB can't stop the earlier sections printing
      const { MemoryService } = require('../../services/memory');
      const { ConfigService } = require('../../services/config');
      const ms = MemoryService.getInstance();
      const projectId = ConfigService.getInstance().getProjectId();
      const stats = ms.getStats();
      const pin = process.env.CLAUDE_RECALL_PROJECT_ID || process.env.CLAUDE_PROJECT_ID;
      line('✓', pin
        ? `project: ${projectId} (PINNED via ${process.env.CLAUDE_RECALL_PROJECT_ID ? 'CLAUDE_RECALL_PROJECT_ID' : 'CLAUDE_PROJECT_ID'})`
        : `project: ${projectId} (from working directory)`);
      line('•', `total memories (all projects): ${stats.total}`);
      const rules = ms.loadActiveRules(projectId);
      const ruleCount = rules.preferences.length + rules.corrections.length + rules.failures.length + rules.devops.length;
      line(ruleCount > 0 ? '✓' : '•', `active rules for this project: ${ruleCount}`);
    } catch (err) {
      line('⚠', `could not open database: ${(err as Error).message}`);
    }

    // --- Kiro agents ---
    console.log('\nKiro agents with Claude Recall wired');
    const agentDirs = [
      { label: 'workspace', dir: path.join(process.cwd(), '.kiro', 'agents') },
      { label: 'global', dir: path.join(os.homedir(), '.kiro', 'agents') },
    ];
    let anyWired = false;
    for (const { label, dir } of agentDirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const info = KiroCommands.inspectAgent(path.join(dir, f));
        if (!info || (!info.mcp && info.hooks.length === 0)) continue;
        anyWired = true;
        const bits = [
          info.mcp ? 'MCP' : null,
          info.hooks.length ? `hooks: ${info.hooks.join(', ')}` : null,
        ].filter(Boolean).join(' | ');
        line('✓', `${info.name} (${label}) — ${bits}`);
      }
    }
    if (!anyWired) {
      line('⚠', 'none found. Run `claude-recall kiro setup` (new agent) or');
      line(' ', '        `claude-recall kiro setup --merge-into <agent>` (existing agent).');
    }

    // --- Capture backend (Kiro LLM classifier) ---
    console.log('\nCapture backend (no ANTHROPIC_API_KEY needed under Kiro)');
    const classifierPath = path.join(os.homedir(), '.kiro', 'agents', `${KiroCommands.CLASSIFIER_AGENT_NAME}.json`);
    if (fs.existsSync(classifierPath)) {
      line('✓', `classifier agent present: ${classifierPath}`);
    } else {
      line('⚠', `classifier agent missing (${KiroCommands.CLASSIFIER_AGENT_NAME}.json) — re-run \`claude-recall kiro setup\` or \`--merge-into\`. Capture falls back to regex without it.`);
    }
    if (resolveOnPath('kiro-cli')) {
      const model = process.env.CLAUDE_RECALL_KIRO_MODEL || 'claude-haiku-4.5';
      line('✓', `kiro-cli on PATH — capture classifies with Kiro's LLM (model: ${model})`);
    } else {
      line('⚠', 'kiro-cli not on PATH — capture cannot reach Kiro\'s LLM and falls back to regex.');
    }
    if (process.env.ANTHROPIC_API_KEY) {
      line('•', 'ANTHROPIC_API_KEY is set — it takes precedence over the Kiro LLM for capture.');
    }

    // --- Hook activity ---
    console.log('\nRecent hook activity');
    const dir = process.env.CLAUDE_RECALL_DB_PATH || path.join(os.homedir(), '.claude-recall');
    const logDir = path.join(dir, 'hook-logs');
    const kiro = KiroCommands.lastLogLine(path.join(logDir, 'kiro.log'));
    const cd = KiroCommands.lastLogLine(path.join(logDir, 'correction-detector.log'));
    if (kiro) {
      line('✓', `kiro hooks last ran${KiroCommands.fmtAge(kiro.ageMs)}: ${kiro.line.replace(/^\[[^\]]+\]\s*/, '')}`);
    } else {
      line('⚠', 'no kiro.log — Kiro hooks have never fired. Kiro snapshots agent config into each conversation at creation, so conversations created before wiring never run hooks (even resumed). Start ONE fresh conversation (no --resume) in each project.');
    }
    if (cd) {
      line('✓', `capture hook last ran${KiroCommands.fmtAge(cd.ageMs)}: ${cd.line.replace(/^\[[^\]]+\]\s*/, '')}`);
    }

    // --- Governance note ---
    console.log('\nNotes');
    line('•', 'If Kiro\'s startup banner omits "claude-recall" from loaded servers, your org likely');
    line(' ', '  restricts MCP to a trusted registry. Hooks still work (capture + injection go straight');
    line(' ', '  to the local DB) — only the interactive MCP tools need an admin to allowlist claude-recall.');
    console.log('');
    process.exit(0);
  }

  static register(program: Command): void {
    const kiroCmd = program
      .command('kiro')
      .description('Kiro CLI integration');

    kiroCmd
      .command('doctor')
      .description('Diagnose the Kiro integration: install, database, wired agents, and whether hooks are firing')
      .action(() => {
        KiroCommands.runDoctor();
      });

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
