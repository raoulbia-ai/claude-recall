import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
  [k: string]: unknown;
}

export interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [k: string]: unknown;
}

export interface SettingsShape {
  hooks?: Record<string, HookGroup[]>;
  hooksVersion?: string;
  [k: string]: unknown;
}

export type Classification =
  | { status: 'ok' }
  | { status: 'non-claude-recall' }
  | { status: 'broken-absolute'; scriptPath: string; hookId: string | null }
  | { status: 'broken-path'; binary: string; hookId: string | null };

export interface HookLocation {
  settingsPath: string;
  event: string;
  groupIndex: number;
  hookIndex: number;
}

export interface Finding {
  location: HookLocation;
  originalCommand: string;
  classification: Classification;
  proposedCommand?: string;
}

export interface FileReport {
  settingsPath: string;
  parseError?: string;
  hooksVersion?: string;
  findings: Finding[];
}

export interface RepairOptions {
  auto?: boolean;
  dryRun?: boolean;
  scope?: 'user' | 'project' | 'all';
  cwd?: string;
  home?: string;
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
  };
  /** Override for tests: whether the `claude-recall` binary resolves on PATH. */
  claudeRecallOnPath?: () => string | null;
  /** Override for tests: interactive y/N prompt. Defaults to non-interactive (false) unless provided. */
  prompt?: (question: string) => Promise<boolean>;
}

export interface RepairResult {
  exitCode: number;
  filesScanned: number;
  filesModified: number;
  fixesApplied: number;
  unfixable: number;
  reports: FileReport[];
}

const CLAUDE_RECALL_CLI_RE = /claude[-_]recall[-_]cli(?:\.js)?/i;
const HOOK_RUN_ID_RE = /hook\s+run\s+(\S+)/i;

/**
 * Resolve a binary name against PATH. POSIX-first; on Windows tries common
 * extensions. Returns the first matching absolute path, or null.
 */
export function resolveOnPath(binName: string): string | null {
  const pathEnv = process.env.PATH || '';
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, binName + ext);
      try {
        const st = fs.statSync(candidate);
        if (st.isFile()) return candidate;
      } catch {
        // not present — keep looking
      }
    }
  }
  return null;
}

/**
 * Decide whether a hook command belongs to claude-recall and, if so, whether
 * its invocation target actually resolves on disk / on PATH. Pure function —
 * no I/O except for the filesystem check on absolute script paths and the
 * PATH probe (which the caller can stub via `claudeRecallResolver`).
 */
export function classifyHook(
  command: string,
  claudeRecallResolver: () => string | null
): Classification {
  const trimmed = command.trim();
  if (!trimmed) return { status: 'non-claude-recall' };

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0] || '';
  const base = path.basename(first);

  const looksLikeCR =
    CLAUDE_RECALL_CLI_RE.test(trimmed) ||
    base === 'claude-recall' ||
    /\bclaude-recall\b/.test(trimmed);

  if (!looksLikeCR) return { status: 'non-claude-recall' };

  const hookIdMatch = trimmed.match(HOOK_RUN_ID_RE);
  const hookId = hookIdMatch ? hookIdMatch[1] : null;

  // Case A: `node /abs/path/to/claude-recall-cli.js hook run ...`
  //         or `/abs/path/to/node /abs/path/.../claude-recall-cli.js ...`
  if (base === 'node' || /\/node$/.test(first)) {
    const script = tokens[1];
    if (script && path.isAbsolute(script) && CLAUDE_RECALL_CLI_RE.test(script)) {
      if (!fs.existsSync(script)) {
        return { status: 'broken-absolute', scriptPath: script, hookId };
      }
      return { status: 'ok' };
    }
    // Unusual node invocation we don't recognize — don't touch.
    return { status: 'ok' };
  }

  // Case B: `claude-recall hook run ...` (PATH-resolved form — what we rewrite to)
  if (base === 'claude-recall') {
    if (claudeRecallResolver()) return { status: 'ok' };
    return { status: 'broken-path', binary: 'claude-recall', hookId };
  }

  // Case C: `npx claude-recall ...` — npx resolves at runtime; treat as OK.
  if (base === 'npx') return { status: 'ok' };

  // Anything else mentioning claude-recall — leave alone.
  return { status: 'ok' };
}

/**
 * Given the closest settings.json-like file path, return the list of paths
 * to scan (settings.json + settings.local.json if present).
 */
function pickSiblings(settingsPath: string): string[] {
  const dir = path.dirname(settingsPath);
  const out: string[] = [];
  for (const name of ['settings.json', 'settings.local.json']) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

export function findSettingsFiles(
  cwd: string,
  home: string,
  scope: 'user' | 'project' | 'all'
): string[] {
  const results: string[] = [];

  if (scope === 'user' || scope === 'all') {
    const userDir = path.join(home, '.claude');
    for (const p of pickSiblings(path.join(userDir, 'settings.json'))) {
      if (!results.includes(p)) results.push(p);
    }
  }

  if (scope === 'project' || scope === 'all') {
    // Walk up looking for the CLOSEST .claude dir containing a settings file
    // (matches Claude Code's own resolution). We don't scan ancestors beyond
    // the first match — those belong to other projects.
    let dir = cwd;
    while (dir !== path.dirname(dir)) {
      const claudeDir = path.join(dir, '.claude');
      const s = path.join(claudeDir, 'settings.json');
      const l = path.join(claudeDir, 'settings.local.json');
      const hasAny = fs.existsSync(s) || fs.existsSync(l);
      if (hasAny) {
        if (fs.existsSync(s) && !results.includes(s)) results.push(s);
        if (fs.existsSync(l) && !results.includes(l)) results.push(l);
        break;
      }
      dir = path.dirname(dir);
    }
  }

  return results;
}

export function scanFile(
  settingsPath: string,
  claudeRecallResolver: () => string | null
): FileReport {
  const report: FileReport = { settingsPath, findings: [] };

  let raw: string;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (e) {
    report.parseError = `cannot read: ${(e as Error).message}`;
    return report;
  }

  let parsed: SettingsShape;
  try {
    parsed = JSON.parse(raw) as SettingsShape;
  } catch (e) {
    report.parseError = `invalid JSON: ${(e as Error).message}`;
    return report;
  }

  if (typeof parsed.hooksVersion === 'string') {
    report.hooksVersion = parsed.hooksVersion;
  }

  const hooks = parsed.hooks;
  if (!hooks || typeof hooks !== 'object') return report;

  const hasCR = (): string | null => claudeRecallResolver();
  // Cache resolver result within a single scan to avoid hammering stat().
  let cached: string | null | undefined;
  const cachingResolver = () => {
    if (cached === undefined) cached = hasCR();
    return cached ?? null;
  };

  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    groups.forEach((group, groupIndex) => {
      if (!group || !Array.isArray(group.hooks)) return;
      group.hooks.forEach((hook, hookIndex) => {
        if (!hook || typeof hook.command !== 'string') return;
        const classification = classifyHook(hook.command, cachingResolver);
        if (classification.status === 'non-claude-recall') return;

        const finding: Finding = {
          location: { settingsPath, event, groupIndex, hookIndex },
          originalCommand: hook.command,
          classification,
        };

        if (classification.status === 'broken-absolute') {
          const crPath = cachingResolver();
          if (crPath) {
            const id = classification.hookId;
            if (id) {
              finding.proposedCommand = `claude-recall hook run ${id}`;
            }
            // If we can't extract a hook id we don't know what subcommand to
            // invoke. Leave proposedCommand unset — reported as unfixable.
          }
        }

        report.findings.push(finding);
      });
    });
  }

  return report;
}

export function applyFixes(
  report: FileReport,
  opts: { dryRun: boolean }
): { changed: boolean; applied: number; backupPath: string | null } {
  if (report.parseError) return { changed: false, applied: 0, backupPath: null };
  const fixable = report.findings.filter(f => f.proposedCommand);
  if (fixable.length === 0) return { changed: false, applied: 0, backupPath: null };

  const raw = fs.readFileSync(report.settingsPath, 'utf8');
  const parsed = JSON.parse(raw) as SettingsShape;
  if (!parsed.hooks) return { changed: false, applied: 0, backupPath: null };

  let applied = 0;
  for (const f of fixable) {
    const { event, groupIndex, hookIndex } = f.location;
    const group = parsed.hooks[event]?.[groupIndex];
    const entry = group?.hooks?.[hookIndex];
    if (!entry) continue;
    // Sanity: only rewrite if the command still matches what we scanned.
    if (entry.command !== f.originalCommand) continue;
    entry.command = f.proposedCommand!;
    applied++;
  }

  if (applied === 0) return { changed: false, applied: 0, backupPath: null };

  if (opts.dryRun) {
    return { changed: true, applied, backupPath: null };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${report.settingsPath}.bak.${ts}`;
  fs.writeFileSync(backupPath, raw);
  fs.writeFileSync(report.settingsPath, JSON.stringify(parsed, null, 2));
  return { changed: true, applied, backupPath };
}

function classify(finding: Finding): 'fixable' | 'unfixable' | 'ok' {
  const c = finding.classification;
  if (c.status === 'ok' || c.status === 'non-claude-recall') return 'ok';
  return finding.proposedCommand ? 'fixable' : 'unfixable';
}

function describe(finding: Finding): string {
  const c = finding.classification;
  const loc = `${finding.location.event}[${finding.location.groupIndex}].hooks[${finding.location.hookIndex}]`;
  if (c.status === 'broken-absolute') {
    return `${loc}  missing script: ${c.scriptPath}`;
  }
  if (c.status === 'broken-path') {
    return `${loc}  '${c.binary}' not on PATH`;
  }
  return `${loc}  ok`;
}

export async function runRepair(options: RepairOptions = {}): Promise<RepairResult> {
  const log = options.logger ?? { log: console.log.bind(console), warn: console.warn.bind(console) };
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? os.homedir();
  const scope = options.scope ?? 'all';
  const resolver = options.claudeRecallOnPath ?? (() => resolveOnPath('claude-recall'));

  log.log('\n🩺 Claude Recall repair (conservative)\n');
  const files = findSettingsFiles(cwd, home, scope);

  if (files.length === 0) {
    log.log(`No settings files found (scope: ${scope}).`);
    log.log('Nothing to repair. If you meant to install hooks, run:');
    log.log('  claude-recall setup --install\n');
    return { exitCode: 0, filesScanned: 0, filesModified: 0, fixesApplied: 0, unfixable: 0, reports: [] };
  }

  const reports: FileReport[] = [];
  let totalFixable = 0;
  let totalUnfixable = 0;
  let totalOk = 0;

  for (const f of files) {
    const report = scanFile(f, resolver);
    reports.push(report);
    if (report.parseError) {
      log.warn(`  ⚠  ${f}: ${report.parseError}`);
      continue;
    }
    let fixable = 0, unfixable = 0, ok = 0;
    for (const finding of report.findings) {
      const kind = classify(finding);
      if (kind === 'fixable') fixable++;
      else if (kind === 'unfixable') unfixable++;
      else ok++;
    }
    totalFixable += fixable;
    totalUnfixable += unfixable;
    totalOk += ok;

    const versionTag = report.hooksVersion ? ` (hooksVersion: ${report.hooksVersion})` : '';
    log.log(`  ${f}${versionTag}`);
    log.log(`    ${ok} OK, ${fixable} fixable, ${unfixable} unfixable`);
    for (const finding of report.findings) {
      if (classify(finding) === 'ok') continue;
      log.log(`    - ${describe(finding)}`);
      if (finding.proposedCommand) {
        log.log(`        proposed: ${finding.proposedCommand}`);
      }
    }
  }

  if (totalFixable === 0) {
    if (totalUnfixable > 0) {
      log.log(`\n${totalUnfixable} broken claude-recall hook(s) found but no safe fix available.`);
      log.log('Install claude-recall on PATH so repair can rewrite the broken paths:');
      log.log('  npm install -g claude-recall\n');
      // Don't fail postinstall — user's current install was fine until their
      // PATH/hook config drifted; this is diagnostic, not an error.
      return {
        exitCode: 0,
        filesScanned: files.length,
        filesModified: 0,
        fixesApplied: 0,
        unfixable: totalUnfixable,
        reports,
      };
    }
    log.log(`\n✅ All ${totalOk} claude-recall hook(s) look healthy. Nothing to do.\n`);
    return {
      exitCode: 0,
      filesScanned: files.length,
      filesModified: 0,
      fixesApplied: 0,
      unfixable: 0,
      reports,
    };
  }

  if (!options.auto && !options.dryRun && options.prompt) {
    const proceed = await options.prompt(`\nApply ${totalFixable} fix(es)? [y/N] `);
    if (!proceed) {
      log.log('Aborted. No files changed.\n');
      return {
        exitCode: 0,
        filesScanned: files.length,
        filesModified: 0,
        fixesApplied: 0,
        unfixable: totalUnfixable,
        reports,
      };
    }
  }

  let filesModified = 0;
  let fixesApplied = 0;
  for (const report of reports) {
    const { changed, applied, backupPath } = applyFixes(report, { dryRun: !!options.dryRun });
    if (changed && !options.dryRun) {
      filesModified++;
      fixesApplied += applied;
      log.log(`  ✓ ${report.settingsPath}: applied ${applied} fix(es)`);
      if (backupPath) log.log(`    backup: ${backupPath}`);
    } else if (changed && options.dryRun) {
      fixesApplied += applied;
      log.log(`  (dry-run) ${report.settingsPath}: would apply ${applied} fix(es)`);
    }
  }

  if (options.dryRun) {
    log.log(`\nDry run complete. ${fixesApplied} fix(es) would be applied across ${reports.filter(r => r.findings.some(f => f.proposedCommand)).length} file(s).\n`);
  } else {
    log.log(`\n✅ Repaired ${fixesApplied} hook(s) across ${filesModified} file(s).`);
    if (totalUnfixable > 0) {
      log.log(`   ${totalUnfixable} issue(s) still need manual attention (see above).`);
    }
    log.log('');
  }

  return {
    exitCode: 0,
    filesScanned: files.length,
    filesModified,
    fixesApplied,
    unfixable: totalUnfixable,
    reports,
  };
}
