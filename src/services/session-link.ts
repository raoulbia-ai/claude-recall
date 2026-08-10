/**
 * Session-identity bridge (#6).
 *
 * There are two unrelated session ids in the system:
 *   - Claude Code's harness `session_id`, known only to the hook processes
 *     (they receive it on stdin) and used to name hook-state files.
 *   - The long-lived MCP server's own per-process id (`session_<ts>_<rand>`),
 *     which is what ends up in search-monitor.log.
 *
 * Because they never met, hook-side state couldn't be correlated with
 * MCP-side activity when debugging. This module is the meeting point: a hook
 * that has the harness id writes it here (keyed by project); the MCP server
 * reads it so it can stamp the harness id onto its own logs.
 *
 * Deliberately dependency-free (fs/path/os only) so both the hooks layer and
 * the services layer can import it without creating a cycle. The directory
 * mirrors the hook-state dir used elsewhere (CLAUDE_RECALL_DB_PATH override or
 * ~/.claude-recall).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function linkDir(): string {
  const base = process.env.CLAUDE_RECALL_DB_PATH || path.join(os.homedir(), '.claude-recall');
  return path.join(base, 'hook-state');
}

function safeId(id: string): string {
  return (id || 'default').replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

export function harnessSessionLinkPath(projectId: string): string {
  return path.join(linkDir(), `harness-session-${safeId(projectId)}.json`);
}

/** Persist the harness session id for a project. No-op for empty/'default'. */
export function writeHarnessSessionLink(sessionId: string, projectId: string): void {
  if (!sessionId || sessionId === 'default') return;
  try {
    fs.mkdirSync(linkDir(), { recursive: true });
    fs.writeFileSync(
      harnessSessionLinkPath(projectId),
      JSON.stringify({ harnessSessionId: sessionId, projectId, updatedAt: Date.now() }),
      'utf8',
    );
  } catch {
    // best-effort — correlation is a debugging aid, never block the caller
  }
}

/** Read the most recently recorded harness session id for a project, or null. */
export function readHarnessSessionLink(projectId: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(harnessSessionLinkPath(projectId), 'utf8'));
    return typeof parsed?.harnessSessionId === 'string' ? parsed.harnessSessionId : null;
  } catch {
    return null;
  }
}
