/**
 * Tests for the session-identity bridge (#6): a hook records Claude Code's
 * harness session_id per project; the MCP server reads it to correlate its
 * own logs with hook-side state.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  writeHarnessSessionLink,
  readHarnessSessionLink,
  harnessSessionLinkPath,
} from '../../src/services/session-link';

describe('session-link (#6)', () => {
  let tmpRoot = '';

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-link-'));
    process.env.CLAUDE_RECALL_DB_PATH = tmpRoot;
  });

  afterEach(() => {
    delete process.env.CLAUDE_RECALL_DB_PATH;
    if (tmpRoot && fs.existsSync(tmpRoot)) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('round-trips a harness session id for a project', () => {
    writeHarnessSessionLink('sess-123', 'proj-A');
    expect(readHarnessSessionLink('proj-A')).toBe('sess-123');
  });

  it('returns null when no link has been written', () => {
    expect(readHarnessSessionLink('never-written')).toBeNull();
  });

  it('isolates the link per project', () => {
    writeHarnessSessionLink('sess-A', 'proj-A');
    writeHarnessSessionLink('sess-B', 'proj-B');
    expect(readHarnessSessionLink('proj-A')).toBe('sess-A');
    expect(readHarnessSessionLink('proj-B')).toBe('sess-B');
  });

  it('overwrites with the latest session id', () => {
    writeHarnessSessionLink('old', 'proj-A');
    writeHarnessSessionLink('new', 'proj-A');
    expect(readHarnessSessionLink('proj-A')).toBe('new');
  });

  it('is a no-op for empty or default session ids', () => {
    writeHarnessSessionLink('', 'proj-A');
    writeHarnessSessionLink('default', 'proj-A');
    expect(readHarnessSessionLink('proj-A')).toBeNull();
  });

  it('writes under the hook-state dir so it sits alongside other session state', () => {
    const p = harnessSessionLinkPath('proj-A');
    expect(p).toBe(path.join(tmpRoot, 'hook-state', 'harness-session-proj-A.json'));
  });

  it('sanitizes unusual project ids into a safe filename', () => {
    writeHarnessSessionLink('sess-x', 'weird/../id name');
    expect(readHarnessSessionLink('weird/../id name')).toBe('sess-x');
    expect(harnessSessionLinkPath('weird/../id name')).not.toContain('/../');
  });

  it('never throws on unreadable/corrupt link files', () => {
    fs.mkdirSync(path.join(tmpRoot, 'hook-state'), { recursive: true });
    fs.writeFileSync(harnessSessionLinkPath('proj-A'), 'not json{', 'utf8');
    expect(readHarnessSessionLink('proj-A')).toBeNull();
  });
});
