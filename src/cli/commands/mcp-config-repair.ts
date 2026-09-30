/**
 * MCP-config repair — the missing half of `claude-recall repair`.
 *
 * `repair.ts` scans `.claude/settings.json` files for broken HOOK commands. It
 * never touches `~/.claude.json`, where Claude Code stores the MCP *server*
 * registration. That file is where the fragile, machine-generated drift lives:
 *
 *   - `npx claude-recall mcp start` launchers (cold-resolve, flaky) sitting
 *     alongside direct-binary entries → different endpoints across scopes →
 *     Claude Code cannot resolve one → CONNECTION_CLOSED.
 *   - Per-project `projects[<path>].mcpServers.claude-recall` duplicates
 *     shadowing a single user-scope entry (the default outcome of adding the
 *     server project-by-project).
 *   - Orphaned absolute command paths (e.g. an nvm node bin dir) that no longer
 *     exist after a node-version switch.
 *
 * This module reads `~/.claude.json`, classifies every claude-recall MCP
 * definition, and consolidates them to ONE canonical user-scope entry using the
 * direct binary — preserving env, never silently dropping it. Pure functions
 * are separated from I/O so they unit-test the same way as repair.ts.
 *
 * Design principle (user's standing rule): MCP must be robust AND not silent.
 * We never guess: an env conflict across scopes is reported as unfixable, not
 * auto-resolved.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** A Claude Code MCP server entry as stored in ~/.claude.json. */
export interface McpServerEntry {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  [k: string]: unknown;
}

/** Where a claude-recall entry was found. */
export type McpScope =
  | { kind: 'user' }
  | { kind: 'project'; projectPath: string };

/**
 * A STRUCTURAL problem with an entry — one that consolidation actually fixes.
 * An entry can carry more than one (e.g. an npx launcher that is ALSO a
 * duplicate project-scope entry). Note: "binary not on PATH" is deliberately
 * NOT here — that's a PATH problem consolidation can't fix, reported by
 * doctor's Install section instead, and keeping it out makes --fix idempotent.
 */
export type McpIssue =
  | 'npx-launcher'
  | 'orphaned-binary'
  | 'duplicate-scope';

export interface McpFinding {
  scope: McpScope;
  command: string;
  issues: McpIssue[];
}

export interface EnvConflict {
  key: string;
  values: string[];
}

export interface McpConfigReport {
  configPath: string;
  /** File exists on disk. */
  present: boolean;
  /** Set when the file exists but is not valid JSON — never throws. */
  parseError?: string;
  /** Every claude-recall MCP entry found, with its issues. */
  findings: McpFinding[];
  /** Total claude-recall entries across all scopes. */
  entryCount: number;
  /** Union of env across all entries (the consolidation target's env). */
  mergedEnv: Record<string, string>;
  /** Env keys with conflicting values across scopes — block auto-fix. */
  envConflicts: EnvConflict[];
  /** True when the config is not already a single canonical user-scope entry. */
  needsConsolidation: boolean;
}

export interface McpApplyResult {
  changed: boolean;
  backupPath: string | null;
  /** Scopes removed (project duplicates). */
  removed: McpScope[];
  /** Reason we declined to change anything, when changed=false but action was expected. */
  blockedReason?: string;
}

const SERVER_KEY = 'claude-recall';

/** Path to Claude Code's global config. `home` is injectable for tests. */
export function mcpConfigPath(home: string = os.homedir()): string {
  return path.join(home, '.claude.json');
}

/**
 * The canonical entry we normalize to: the direct binary on PATH, Claude Code's
 * stdio shape. (Deliberately NOT KiroCommands.buildMcpServerEntry — that adds a
 * `timeout` for Kiro agent configs; Claude Code entries use `type: "stdio"` and
 * an `env` object instead.)
 */
export function canonicalEntry(env: Record<string, string>): McpServerEntry {
  return {
    type: 'stdio',
    command: 'claude-recall',
    args: ['mcp', 'start'],
    env: { ...env },
  };
}

/** True when an entry already matches the canonical shape (idempotency guard). */
export function isCanonical(entry: McpServerEntry): boolean {
  return (
    entry.command === 'claude-recall' &&
    Array.isArray(entry.args) &&
    entry.args.length === 2 &&
    entry.args[0] === 'mcp' &&
    entry.args[1] === 'start'
  );
}

/**
 * Classify a single entry for STRUCTURAL drift. Pure except for a disk check on
 * an absolute command path.
 */
export function classifyMcpEntry(entry: McpServerEntry): McpIssue[] {
  const issues: McpIssue[] = [];
  const command = (entry.command || '').trim();

  if (command === 'npx') {
    issues.push('npx-launcher');
    return issues; // npx always normalizes to the binary; no further checks
  }

  // An absolute command path that no longer exists = orphaned (the classic
  // node-version-switch casualty: bin dir under a now-inactive nvm version).
  if (path.isAbsolute(command) && !fs.existsSync(command)) {
    issues.push('orphaned-binary');
  }

  return issues;
}

/**
 * Read and analyze ~/.claude.json. Never throws — a missing or malformed file
 * is reported, not raised.
 */
export function scanMcpConfig(home: string = os.homedir()): McpConfigReport {
  const configPath = mcpConfigPath(home);
  const base: McpConfigReport = {
    configPath,
    present: false,
    findings: [],
    entryCount: 0,
    mergedEnv: {},
    envConflicts: [],
    needsConsolidation: false,
  };

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch {
    return base; // absent — nothing to do
  }
  base.present = true;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    base.parseError = `invalid JSON: ${(e as Error).message}`;
    return base;
  }

  const entries: Array<{ scope: McpScope; entry: McpServerEntry }> = [];

  const userEntry = parsed?.mcpServers?.[SERVER_KEY];
  if (userEntry && typeof userEntry === 'object') {
    entries.push({ scope: { kind: 'user' }, entry: userEntry });
  }

  if (parsed?.projects && typeof parsed.projects === 'object') {
    for (const [projectPath, projCfg] of Object.entries<any>(parsed.projects)) {
      const e = projCfg?.mcpServers?.[SERVER_KEY];
      if (e && typeof e === 'object') {
        entries.push({ scope: { kind: 'project', projectPath }, entry: e });
      }
    }
  }

  base.entryCount = entries.length;
  const hasUser = entries.some(e => e.scope.kind === 'user');

  // Env union + conflict detection across every entry.
  const envValues: Record<string, Set<string>> = {};
  for (const { scope, entry } of entries) {
    const issues = classifyMcpEntry(entry);
    // A project-scope entry is a duplicate whenever a user-scope one also
    // exists (it shadows the global registration for that project only).
    if (scope.kind === 'project' && hasUser) issues.push('duplicate-scope');
    base.findings.push({ scope, command: (entry.command || '').trim(), issues });

    const env = entry.env;
    if (env && typeof env === 'object') {
      for (const [k, v] of Object.entries(env)) {
        (envValues[k] ??= new Set()).add(String(v));
      }
    }
  }

  for (const [key, values] of Object.entries(envValues)) {
    if (values.size === 1) {
      base.mergedEnv[key] = [...values][0];
    } else {
      base.envConflicts.push({ key, values: [...values] });
    }
  }

  // Consolidation needed when it's not already exactly one canonical user entry.
  // Driven only by STRUCTURAL issues (npx/orphaned/duplicate) + shape, so a
  // healthy single entry is stable across re-runs (idempotent --fix).
  const anyIssue = base.findings.some(f => f.issues.length > 0);
  const singleUserCanonical =
    entries.length === 1 &&
    entries[0].scope.kind === 'user' &&
    isCanonical(entries[0].entry);
  base.needsConsolidation = entries.length > 0 && (!singleUserCanonical || anyIssue);

  return base;
}

/**
 * Consolidate to a single canonical user-scope entry, preserving merged env.
 * Refuses (changed=false + blockedReason) on an env conflict — we never guess
 * which value the user meant. Backs up first, writes atomically.
 */
export function applyMcpConsolidation(
  report: McpConfigReport,
  opts: { dryRun?: boolean; home?: string } = {},
): McpApplyResult {
  const home = opts.home ?? os.homedir();
  const configPath = mcpConfigPath(home);

  if (report.parseError) {
    return { changed: false, backupPath: null, removed: [], blockedReason: report.parseError };
  }
  if (!report.needsConsolidation) {
    return { changed: false, backupPath: null, removed: [] };
  }
  if (report.envConflicts.length > 0) {
    const keys = report.envConflicts.map(c => c.key).join(', ');
    return {
      changed: false,
      backupPath: null,
      removed: [],
      blockedReason: `conflicting env across scopes (${keys}) — resolve manually; not auto-consolidating`,
    };
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  // 1. Set the single user-scope canonical entry.
  parsed.mcpServers = parsed.mcpServers || {};
  parsed.mcpServers[SERVER_KEY] = canonicalEntry(report.mergedEnv);

  // 2. Delete every per-project duplicate.
  const removed: McpScope[] = [];
  if (parsed.projects && typeof parsed.projects === 'object') {
    for (const [projectPath, projCfg] of Object.entries<any>(parsed.projects)) {
      if (projCfg?.mcpServers && projCfg.mcpServers[SERVER_KEY]) {
        delete projCfg.mcpServers[SERVER_KEY];
        removed.push({ kind: 'project', projectPath });
      }
    }
  }

  if (opts.dryRun) {
    return { changed: true, backupPath: null, removed };
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${configPath}.bak.${ts}`;
  fs.writeFileSync(backupPath, raw);
  const tmp = `${configPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2));
  fs.renameSync(tmp, configPath);

  return { changed: true, backupPath, removed };
}

/** Human-readable one-liner for an issue (used by doctor output). */
export function describeIssue(issue: McpIssue): string {
  switch (issue) {
    case 'npx-launcher':
      return 'uses npx launcher (flaky cold-resolve; can cause CONNECTION_CLOSED)';
    case 'orphaned-binary':
      return 'absolute command path no longer exists (node-version switch?)';
    case 'duplicate-scope':
      return 'per-project duplicate shadowing the user-scope entry';
  }
}

/** Short label for a scope (used by doctor output). */
export function describeScope(scope: McpScope): string {
  return scope.kind === 'user' ? 'user scope' : `project ${scope.projectPath}`;
}
