// Type-only import so commander (ESM-only in v15) never enters jest's CJS
// transform via this module — same pattern as kiro-commands.ts.
import type { Command } from 'commander';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  resolveOnPath,
  nodeVersionFromPath,
  findSettingsFiles,
  scanFile,
  runRepair,
  FileReport,
} from './repair';
import {
  scanMcpConfig,
  applyMcpConsolidation,
  describeIssue,
  describeScope,
  McpConfigReport,
} from './mcp-config-repair';

/**
 * `claude-recall doctor` — a general, read-only health verdict for the whole
 * install, and the fix path for MCP-config drift (`doctor --fix`).
 *
 * This is the "not silent" half of the MCP-robustness work: one command that
 * tells a user whether memory is actually working, so a healthy session and a
 * broken one never look identical. It supersedes `mcp test` (which only checked
 * top-level registration) and complements `kiro doctor` (Kiro-specific).
 *
 * DB access is LAZY throughout: doctor must keep working when better-sqlite3's
 * native binding is broken — that's exactly the state a user runs doctor to
 * diagnose (see the contract note in claude-recall-cli.ts).
 */
export class DoctorCommands {
  /** Detect a node-version-orphaned binary (nvm switch casualty). */
  static nodeVersionInfo(binPath: string | null): { mismatch: boolean; binNodeVersion?: string } {
    if (!binPath) return { mismatch: false };
    const v = nodeVersionFromPath(binPath);
    if (!v) return { mismatch: false };
    return { mismatch: v !== process.version, binNodeVersion: v };
  }

  /**
   * Spawn the MCP server via node + the CLI script (PATH-independent) and do a
   * real `initialize` handshake. Proves the server code + DB actually work,
   * isolating "config is broken" from "server is broken". Never hangs — killed
   * on timeout.
   */
  static smokeTestServer(timeoutMs = 6000): Promise<{ ok: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const cliScript = path.resolve(__dirname, '..', 'claude-recall-cli.js');
      let child;
      try {
        child = spawn(process.execPath, [cliScript, 'mcp', 'start'], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ ok: false, error: (e as Error).message });
        return;
      }

      let buf = '';
      let done = false;
      const finish = (r: { ok: boolean; version?: string; error?: string }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { child!.kill('SIGKILL'); } catch { /* already gone */ }
        resolve(r);
      };
      const timer = setTimeout(() => finish({ ok: false, error: `no response within ${timeoutMs}ms` }), timeoutMs);

      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let idx: number;
        while ((idx = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.id === 1 && msg.result?.serverInfo) {
              finish({ ok: true, version: msg.result.serverInfo.version });
              return;
            }
          } catch { /* partial or non-JSON boot noise — keep reading */ }
        }
      });
      child.on('error', (e: Error) => finish({ ok: false, error: e.message }));
      child.on('exit', (code: number | null) =>
        finish({ ok: false, error: `server exited (code ${code}) before responding` }));

      const req = JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'doctor', version: '0' } },
      });
      try { child.stdin.write(req + '\n'); } catch (e) { finish({ ok: false, error: (e as Error).message }); }
    });
  }

  /** Print the MCP-config section; apply the fix when `fix` is set. Returns problem count. */
  static reportMcpConfig(report: McpConfigReport, fix: boolean, log: (m: string) => void): number {
    const line = (marker: string, text: string) => log(`  ${marker} ${text}`);

    if (!report.present) {
      line('•', '~/.claude.json not found — no MCP registration to check');
      return 0;
    }
    if (report.parseError) {
      line('⚠', `~/.claude.json ${report.parseError} — cannot analyze MCP config`);
      return 1;
    }
    if (report.entryCount === 0) {
      line('⚠', 'no claude-recall MCP server registered in ~/.claude.json');
      line(' ', '        register it, or run: npm install -g claude-recall');
      return 1;
    }

    const withIssues = report.findings.filter(f => f.issues.length > 0);
    if (withIssues.length === 0 && !report.needsConsolidation) {
      line('✓', `single canonical claude-recall entry (${report.entryCount === 1 ? 'user scope' : report.entryCount + ' entries'})`);
      return 0;
    }

    const problems = withIssues.length || (report.needsConsolidation ? 1 : 0);
    line('⚠', `${report.entryCount} claude-recall MCP entr${report.entryCount === 1 ? 'y' : 'ies'}; config needs consolidation`);
    for (const f of withIssues) {
      for (const issue of f.issues) {
        line(' ', `        - ${describeScope(f.scope)}: ${describeIssue(issue)}`);
      }
    }

    if (report.envConflicts.length > 0) {
      const keys = report.envConflicts.map(c => c.key).join(', ');
      line('⚠', `env conflict across scopes (${keys}) — cannot auto-consolidate; resolve manually`);
    }

    if (!fix) {
      line(' ', '        fix: claude-recall doctor --fix');
      return problems;
    }

    const result = applyMcpConsolidation(report);
    if (result.changed) {
      line('✓', `consolidated to a single user-scope binary entry (removed ${result.removed.length} duplicate${result.removed.length === 1 ? '' : 's'})`);
      if (result.backupPath) line(' ', `        backup: ${result.backupPath}`);
      line(' ', '        restart Claude Code for it to take effect');
      return 0;
    }
    line('⚠', `not fixed: ${result.blockedReason ?? 'nothing to change'}`);
    return problems;
  }

  /** One-line description of a broken/orphaned hook finding for doctor output. */
  static describeHookFinding(settingsPath: string, c: import('./repair').Classification): string {
    const where = `${path.basename(path.dirname(path.dirname(settingsPath)))}/.claude/${path.basename(settingsPath)}`;
    if (c.status === 'orphaned-node') {
      return `${where}: hook built for node ${c.scriptNodeVersion}, active is ${process.version} — will crash on load (silent DB-write loss)`;
    }
    if (c.status === 'broken-absolute') {
      return `${where}: hook points at a missing script (${c.scriptPath})`;
    }
    if (c.status === 'broken-path') {
      return `${where}: hook uses '${c.binary}' which is not on PATH`;
    }
    return `${where}: ${c.status}`;
  }

  /**
   * Print the Hooks section — the fix for doctor's blind spot. It inspects the
   * hook COMMANDS Claude Code actually runs (via repair's scanner), not the CLI
   * path, so a node-version-orphaned hook is caught even when the CLI/DB looks
   * healthy. When `fix` is set, runs `repair --auto` to rewrite them.
   */
  static async reportHooks(
    home: string,
    cwd: string,
    fix: boolean,
    log: (m: string) => void,
    resolver: () => string | null = () => resolveOnPath('claude-recall'),
  ): Promise<number> {
    const line = (marker: string, text: string) => log(`  ${marker} ${text}`);
    const files = findSettingsFiles(cwd, home, 'all');
    if (files.length === 0) {
      line('•', 'no Claude Code settings files found — no hooks to check');
      return 0;
    }

    const badStatuses = new Set(['orphaned-node', 'broken-absolute', 'broken-path']);
    const bad: string[] = [];
    let okCount = 0;
    for (const f of files) {
      const r: FileReport = scanFile(f, resolver);
      if (r.parseError) { bad.push(`${f}: ${r.parseError}`); continue; }
      for (const finding of r.findings) {
        if (badStatuses.has(finding.classification.status)) {
          bad.push(DoctorCommands.describeHookFinding(f, finding.classification));
        } else {
          okCount++;
        }
      }
    }

    if (bad.length === 0) {
      line('✓', `all ${okCount} claude-recall hook(s) healthy (${files.length} settings file${files.length === 1 ? '' : 's'})`);
      return 0;
    }

    line('⚠', `${bad.length} broken/orphaned hook entr${bad.length === 1 ? 'y' : 'ies'} — these hooks crash silently`);
    for (const d of bad) line(' ', `        - ${d}`);

    if (!fix) {
      line(' ', '        fix: claude-recall doctor --fix');
      return bad.length;
    }

    // Repair rewrites orphaned/broken absolute paths to the portable PATH form
    // (backup + atomic write handled inside runRepair).
    const res = await runRepair({
      auto: true, scope: 'all', cwd, home,
      logger: { log: () => {}, warn: () => {} },
      claudeRecallOnPath: resolver,
    });
    if (res.fixesApplied > 0) {
      line('✓', `repaired ${res.fixesApplied} hook(s) across ${res.filesModified} file(s) — rewrote to the PATH form`);
      line(' ', '        restart Claude Code for it to take effect');
      return res.unfixable;
    }
    line('⚠', `could not auto-repair (${res.unfixable} unfixable) — run: claude-recall repair`);
    return bad.length;
  }

  static async runDoctor(options: { fix?: boolean; home?: string } = {}): Promise<void> {
    const home = options.home ?? os.homedir();
    const log = (m: string) => console.log(m);
    const line = (marker: string, text: string) => log(`  ${marker} ${text}`);
    let problems = 0;

    log('\n🩺 Claude Recall — doctor\n');

    // --- Install ---
    log('Install');
    let version = 'unknown';
    try {
      version = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')).version;
    } catch { /* leave unknown */ }
    line('•', `version: ${version}`);

    const onPath = resolveOnPath('claude-recall');
    line(onPath ? '✓' : '⚠', onPath ? `on PATH: ${onPath}` : 'claude-recall not on PATH — hooks/MCP launch will fail (exit 127)');
    if (!onPath) problems++;

    const nv = DoctorCommands.nodeVersionInfo(onPath);
    if (nv.mismatch) {
      line('⚠', `binary lives under node ${nv.binNodeVersion} but active node is ${process.version} — likely orphaned after a version switch`);
      line(' ', `        fix: npm install -g claude-recall (under the active node), or add it to ~/.nvm/default-packages`);
      problems++;
    } else {
      line('✓', `active node: ${process.version}`);
    }

    // --- MCP config (~/.claude.json) ---
    log('\nMCP configuration (~/.claude.json)');
    const report = scanMcpConfig(home);
    problems += DoctorCommands.reportMcpConfig(report, !!options.fix, log);

    // --- Hooks (the path Claude Code actually runs — catches node-version orphans) ---
    log('\nHooks (Claude Code settings.json)');
    problems += await DoctorCommands.reportHooks(home, process.cwd(), !!options.fix, log);

    // --- Live server smoke-test ---
    log('\nServer');
    const smoke = await DoctorCommands.smokeTestServer();
    if (smoke.ok) {
      line('✓', `MCP server responds to initialize (v${smoke.version}) — server code is healthy`);
    } else {
      line('⚠', `MCP server did not respond: ${smoke.error}`);
      problems++;
    }

    // --- Database (LAZY — must not crash doctor if the native binding is broken) ---
    log('\nDatabase');
    try {
      const { MemoryService } = require('../../services/memory');
      const { ConfigService } = require('../../services/config');
      const ms = MemoryService.getInstance();
      const projectId = ConfigService.getInstance().getProjectId();
      const stats = ms.getStats();
      line('✓', `reachable — ${stats.total} memories total, project: ${projectId}`);
      const rules = ms.loadActiveRules(projectId);
      const ruleCount =
        rules.preferences.length + rules.corrections.length + rules.failures.length +
        rules.devops.length + (rules.solutions ?? []).length;
      line(ruleCount > 0 ? '✓' : '•', `active rules for this project: ${ruleCount}`);
    } catch (err) {
      line('⚠', `could not open database: ${(err as Error).message}`);
      problems++;
    }

    // --- Verdict ---
    log('');
    if (problems === 0) {
      log('✅ All checks passed — memory is active and healthy.\n');
      process.exit(0);
    }
    log(`⚠️  ${problems} issue${problems === 1 ? '' : 's'} found.${options.fix ? '' : ' Re-run with --fix to repair MCP config + hooks.'}\n`);
    process.exit(1);
  }

  static register(program: Command): void {
    program
      .command('doctor')
      .description('Health check: install, MCP config, hooks, live server, database. --fix repairs MCP config + hook drift.')
      .option('--fix', 'Repair MCP config in ~/.claude.json and rewrite orphaned/broken hook paths (backups written first)')
      .action(async (options) => {
        await DoctorCommands.runDoctor({ fix: options.fix });
      });
  }
}
