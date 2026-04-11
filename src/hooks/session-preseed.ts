import * as fs from 'fs';
import * as path from 'path';

/**
 * Session Preseed Hook
 *
 * Pre-seeds the search_enforcer hook state at session start so that
 * tools are not blocked before load_rules is called.
 *
 * Without this, the search_enforcer blocks Read/Bash/Edit until
 * load_rules is explicitly called, which creates a deadlock because
 * Claude often needs to read files before it knows to call load_rules.
 *
 * The preseed sets lastSearchAt to the current time, allowing the
 * enforcer to pass through. The actual load_rules call will happen
 * naturally during the session and refresh the state with real data.
 */
export async function handleSessionPreseed(input: string): Promise<void> {
  try {
    const parsed = JSON.parse(input || '{}');
    const sessionId = parsed.session_id || 'default';

    const stateDir = path.join(
      process.env.HOME || process.env.USERPROFILE || '.',
      '.claude-recall',
      'hook-state'
    );

    fs.mkdirSync(stateDir, { recursive: true });

    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
    const stateFile = path.join(stateDir, `${safeId}.json`);

    const state = {
      lastSearchAt: Date.now(),
      searchQuery: 'preseed-session-start',
      blockCount: 0
    };

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } catch {
    // Hooks must never block Claude — silently fail
  }
}
