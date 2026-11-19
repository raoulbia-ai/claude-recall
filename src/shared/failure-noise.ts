/**
 * One filter for every failure-capture path (Claude Code's PostToolUseFailure
 * hook, the PostToolUse Bash watcher, the Stop hook's transcript scan, and
 * Pi). Before 0.52.1 each path had its own idea of noise, and the busiest one
 * (PostToolUseFailure) had none at all, so the review queue filled with:
 *
 *   1. lookups that answered "no"        `ls missing`, `grep x f`, `pgrep y`
 *   2. processes that were killed         exit 124 / 130 / 128+N (pkill, timeout)
 *   3. the same failure, twice            hook + transcript both recording it
 *   4. the outside world misbehaving      WebFetch blocked, an MCP server down
 *   5. failures with nothing to learn     bare "Exit code N", scratch-dir scripts
 *
 * `failureNoiseReason` covers 1, 2, 4 and 5; `isKnownFailure` covers 3.
 */

import * as fs from 'fs';
import * as path from 'path';

const EXIT_CODE = /Exit code (\d+)/;

export function exitCodeOf(text: string): string | null {
  const m = (text || '').match(EXIT_CODE);
  return m ? m[1] : null;
}

/** Split a shell command into its simple commands (&&, ||, ;, |, newlines). */
function segments(command: string): string[] {
  // Split outside quotes only: `grep 'a|b' f` is one command, not two.
  const parts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ';' || c === '\n' || c === '|' || (c === '&' && command[i + 1] === '&')) {
      if (c === '&' || (c === '|' && command[i + 1] === '|')) i++;
      parts.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  parts.push(cur);
  return parts
    .map(s => s.trim().replace(/^[({]\s*/, '').replace(/^(?:\w+=\S*\s+)+/, ''))
    .filter(Boolean);
}

/**
 * Read-only lookups. For these, exit 1 or 2 is an answer ("no match",
 * "no such file", "no such process"), not a mistake.
 */
const LOOKUP = new RegExp('^(?:' + [
  'ls', 'll', 'cat', 'head', 'tail', 'less', 'wc', 'file', 'stat', 'tree', 'du', 'df',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'locate',
  'test', '\\[', '\\[\\[', 'pgrep', 'pidof', 'ps', 'which', 'type', 'command\\s+-v', 'whereis',
  'echo', 'printf', 'pwd', 'cd', 'true', 'false', 'sort', 'uniq', 'cut', 'tr', 'awk', 'sed\\s+-n', 'jq', 'diff', 'cmp',
  'readlink', 'realpath', 'basename', 'dirname', 'env', 'printenv', 'id', 'whoami', 'hostname', 'uname', 'date',
  'git\\s+(?:status|log|show|diff|check-ignore|ls-files|rev-parse|branch|remote|config\\s+--get\\S*|describe|merge-base|blame|grep)',
  'sqlite3\\s+-readonly', 'curl\\s+-s\\S*\\s+-I', 'npm\\s+(?:view|ls|outdated)', 'gh\\s+\\S+\\s+(?:view|list|status|checks)',
].join('|') + ')(?:\\s|$)', 'i');

/** True when every part of the command is a read-only lookup. */
export function isLookupCommand(command: string): boolean {
  const parts = segments(command);
  return parts.length > 0 && parts.every(p => {
    // A redirect into a file (`cat > f`, `echo x >> f`) writes, so it isn't a lookup.
    const unredirected = p.replace(/\d?>&\d/g, '').replace(/\d?>\s*\/dev\/null/g, '');
    return LOOKUP.test(p) && !/>/.test(unredirected);
  });
}

/** Exit codes that mean "stopped from outside", not "went wrong". */
export function isKilledExit(code: string | null): boolean {
  if (!code) return false;
  const n = Number(code);
  // 124: timeout(1). 130: Ctrl-C. 129–165: killed by signal N (128+N), e.g.
  // 143 SIGTERM, 137 SIGKILL, 144 (pkill -f matching its own shell).
  return n === 124 || (n > 128 && n < 166);
}

/** Tools whose failures are usually about the outside world, not the project. */
export function isExternalTool(toolName: string): boolean {
  return toolName === 'WebFetch' || toolName === 'WebSearch' || toolName.startsWith('mcp__');
}

/** Agent scratch space: one-off scripts there carry no lesson for the project. */
function inScratchDir(command: string): boolean {
  return /(^|[\s='"])\/tmp\/claude-\d+\//.test(command)
    || /\/scratchpad\//.test(command)
    || /\$\{?CLAUDE_JOB_DIR\b/.test(command)
    || /\/\.claude\/jobs\//.test(command);
}

/**
 * Code the agent wrote on the spot and ran once: a heredoc or `-c`/`-e`
 * string fed to an interpreter (locally or over ssh). When that fails, the
 * error is in the throwaway code (a typo, a wrong key), not in the project.
 */
const INLINE_SCRIPT = /\b(?:python3?|node|ruby|perl|bash|sh|deno|bun)\s+(?:-\s*<<|-[ce]\s|<<)/;
const ERROR_IN_INLINE_CODE = /File "<(?:stdin|string)>"|^\s*SyntaxError\b|\[eval\]|<anonymous>/m;
/** An inline script that failed because something is missing is a real environment lesson. */
const ENVIRONMENT_ERROR = /ModuleNotFoundError|No module named|ImportError|Cannot find module|command not found|not installed/i;

function isOneOffScript(command: string, text: string): boolean {
  if (ENVIRONMENT_ERROR.test(text)) return false;
  return INLINE_SCRIPT.test(command) && (ERROR_IN_INLINE_CODE.test(text) || /Traceback \(most recent call last\)/.test(text));
}

/** The error text minus the "Exit code N" marker: is there a message at all? */
function hasRealMessage(text: string): boolean {
  const rest = (text || '').replace(/Exit code \d+/g, '').replace(/\(no output\)/gi, '').trim();
  return rest.length >= 10;
}

export interface FailureEvent {
  toolName: string;
  /** Bash command, when the tool is Bash. */
  command?: string;
  /** Error text or tool output. */
  text: string;
}

/**
 * Why this failure is noise, or null when it's worth a review. External-tool
 * failures are judged by `externalFailureRepeats`, which needs session state.
 */
export function failureNoiseReason(e: FailureEvent): string | null {
  const isBash = e.toolName === 'Bash' || e.toolName === 'bash';
  if (!isBash) return null;
  const command = (e.command || '').trim();
  if (!command) return null;
  const code = exitCodeOf(e.text);

  if (isKilledExit(code)) return `killed or timed out (exit ${code})`;
  if ((code === '1' || code === '2') && isLookupCommand(command)) return `lookup answered "no" (exit ${code})`;
  if (!hasRealMessage(e.text)) return 'no error message beyond the exit code';
  if (inScratchDir(command)) return 'one-off command in the scratch directory';
  if (isOneOffScript(command, e.text)) return 'error in a one-off inline script';
  return null;
}

/**
 * External tools fail for reasons outside the project (a blocked domain, an
 * MCP server that's down). Keep one only once the same failure has shown up
 * in two different sessions. Returns true when this occurrence should be kept.
 */
export function externalFailureRepeats(stateDir: string, toolName: string, error: string, sessionId: string): boolean {
  const file = path.join(stateDir, 'external-failures.json');
  const key = `${toolName}:${(error || '').replace(/\s+/g, ' ').trim().slice(0, 120)}`;
  let seen: Record<string, { sessions: string[]; at: number }> = {};
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }

  const entry = seen[key] ?? { sessions: [], at: 0 };
  if (!entry.sessions.includes(sessionId)) entry.sessions.push(sessionId);
  entry.sessions = entry.sessions.slice(-5);
  entry.at = Date.now();
  seen[key] = entry;

  // Keep the file small: newest 200 keys.
  const keys = Object.keys(seen).sort((a, b) => seen[b].at - seen[a].at);
  for (const k of keys.slice(200)) delete seen[k];
  try { fs.writeFileSync(file, JSON.stringify(seen)); } catch { /* best-effort */ }

  return entry.sessions.length >= 2;
}

/**
 * Has this exact command already been recorded as a failure in this project,
 * in any state (active, waiting for review, rejected, expired)? Catches the
 * same failure arriving through two capture paths, and stops a failure the
 * user already rejected from coming back for review.
 */
export function isKnownFailure(
  db: { prepare(sql: string): { get(...a: any[]): any } },
  command: string,
  projectId?: string,
): boolean {
  const needle = command.trim().slice(0, 80);
  if (needle.length < 5) return false;
  // Values are stored as JSON, so look for the command as JSON would write it.
  const encoded = JSON.stringify(needle).slice(1, -1);
  const scope = projectId ? 'AND (project_id = ? OR project_id IS NULL)' : '';
  const params: any[] = [encoded];
  if (projectId) params.push(projectId);
  try {
    return !!db.prepare(
      `SELECT 1 FROM memories WHERE type = 'failure' AND instr(value, ?) > 0 ${scope} LIMIT 1`
    ).get(...params);
  } catch {
    return false;
  }
}
