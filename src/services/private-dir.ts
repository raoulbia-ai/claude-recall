import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The default data directory: ~/.claude-recall. */
export function defaultDataDir(home: string = os.homedir()): string {
  return path.join(home, '.claude-recall');
}

/**
 * Ensure `dir` exists and is readable only by its owner (0o700). The memory DB,
 * hook logs and session state live here and can hold anything a user typed, so
 * the default umask (usually 0o755) would let any other local account read them.
 *
 * Created dirs always get 0o700. An EXISTING dir is tightened only when
 * `tighten` is set — callers pass it for the default ~/.claude-recall (ours),
 * never for a user-chosen CLAUDE_RECALL_DB_PATH, which may be shared on purpose.
 * Best effort: permission errors never fail startup. POSIX only.
 */
export function ensurePrivateDir(dir: string, opts: { tighten?: boolean } = {}): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (!opts.tighten || process.platform === 'win32') return;
  try {
    const mode = fs.statSync(dir).mode & 0o777;
    if (mode & 0o077) fs.chmodSync(dir, mode & 0o700);
  } catch {
    // not ours to fix (e.g. owned by another user) — leave it
  }
}
