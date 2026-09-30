// Type-only import (commander is ESM-only) — same pattern as the other command
// modules so jest's CJS transform never pulls commander in.
import type { Command } from 'commander';

/**
 * `claude-recall statusline` — a one-line, USER-VISIBLE memory indicator for
 * Claude Code's `statusLine` setting.
 *
 * Why a statusLine and not a hook: Claude Code treats SessionStart hook stdout
 * as model context only — it is never shown to the user (verified against the
 * hooks docs). A `statusLine` command, by contrast, renders a persistent bar at
 * the bottom of the terminal. So THIS is the real "memory is on" affordance;
 * the SessionStart banner stays only to prime the model.
 *
 * Claude Code pipes session JSON on stdin (workspace.current_dir, session_id, …)
 * and displays the command's stdout. We scope to the reported project and print
 * `🧠 Recall · N rules · <project>`. Everything is best-effort and fail-safe —
 * a broken DB or missing stdin must never put an error in the status bar.
 */
export class StatuslineCommands {
  /** Pure, testable formatter for the status line text. */
  static format(projectId: string, ruleCount: number): string {
    return `🧠 Recall · ${ruleCount} rule${ruleCount === 1 ? '' : 's'} · ${projectId}`;
  }

  /**
   * Resolve the project id the same way ConfigService.getProjectId does — an
   * explicit env pin wins, otherwise the basename of the working directory.
   * Computed DIRECTLY (not via the ConfigService singleton, which caches the
   * project at CLI startup before we've read the statusline's cwd), and passed
   * straight to loadActiveRules.
   */
  static resolveProjectId(cwd: string): string {
    const path = require('path');
    return (
      process.env.CLAUDE_RECALL_PROJECT_ID ||
      process.env.CLAUDE_PROJECT_ID ||
      path.basename(cwd || process.cwd())
    );
  }

  /**
   * The working directory Claude Code reports on stdin (workspace.current_dir).
   * Best-effort; never blocks an interactive terminal (isTTY guard) or throws.
   */
  static stdinCwd(): string | null {
    try {
      if (process.stdin.isTTY) return null;
      const fs = require('fs');
      let raw = '';
      try { raw = fs.readFileSync(0, 'utf-8'); } catch { return null; }
      if (!raw || !raw.trim()) return null;
      const data = JSON.parse(raw);
      return data?.workspace?.current_dir || data?.cwd || null;
    } catch {
      return null;
    }
  }

  static run(): void {
    const cwd = StatuslineCommands.stdinCwd() || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const projectId = StatuslineCommands.resolveProjectId(cwd);
    try {
      // Lazy require so a broken native SQLite binding can't crash the status
      // bar — it just shows the minimal indicator below.
      const { MemoryService } = require('../../services/memory');
      const r = MemoryService.getInstance().loadActiveRules(projectId);
      const n =
        r.preferences.length + r.corrections.length + r.failures.length +
        r.devops.length + (r.solutions ?? []).length;
      process.stdout.write(StatuslineCommands.format(projectId, n) + '\n');
    } catch {
      // Never emit an error into the status bar.
      process.stdout.write('🧠 Recall\n');
    }
  }

  static register(program: Command): void {
    program
      .command('statusline')
      .description('Print a one-line memory indicator for Claude Code\'s settings.json "statusLine"')
      .action(() => {
        StatuslineCommands.run();
        process.exit(0);
      });
  }
}
