import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { MemoryStorage } from '../../src/memory/storage';
import { sanitizeSource, MAX_SOURCE_EXCERPT_CHARS } from '../../src/services/memory';
import { formatSource } from '../../src/mcp/tools/memory-tools';
import { hookSource } from '../../src/hooks/shared';

const TRANSCRIPT = '/home/u/.claude/projects/p/0b1c-session.jsonl';

describe('memory source provenance', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  it('saves and returns the source fields', () => {
    storage.save({
      key: 'src-1',
      value: { content: 'always use pnpm' },
      type: 'preference',
      source_session: 'sess-1',
      source_transcript: TRANSCRIPT,
      source_entry: 'entry-uuid-1',
      source_excerpt: 'from now on always use pnpm, never npm',
    });
    const m = storage.retrieve('src-1');
    expect(m?.source_excerpt).toBe('from now on always use pnpm, never npm');
    expect(m?.source_session).toBe('sess-1');
    expect(m?.source_transcript).toBe(TRANSCRIPT);
    expect(m?.source_entry).toBe('entry-uuid-1');
  });

  it('returns null sources for memories stored without one', () => {
    storage.save({ key: 'src-none', value: { content: 'x rule here' }, type: 'preference' });
    const m = storage.retrieve('src-none');
    expect(m?.source_session).toBeNull();
    expect(m?.source_transcript).toBeNull();
    expect(m?.source_entry).toBeNull();
    expect(m?.source_excerpt).toBeNull();
  });

  it('keeps the original source when the same key is re-saved without one', () => {
    storage.save({
      key: 'src-2',
      value: { content: 'first' },
      type: 'preference',
      source_session: 'sess-2',
      source_transcript: TRANSCRIPT,
      source_excerpt: 'the first words',
    });
    storage.save({ key: 'src-2', value: { content: 'second' }, type: 'preference' });
    const m = storage.retrieve('src-2');
    expect(m?.value).toEqual({ content: 'second' });
    expect(m?.source_session).toBe('sess-2');
    expect(m?.source_transcript).toBe(TRANSCRIPT);
    expect(m?.source_excerpt).toBe('the first words');
  });

  it('adds the columns to a database created before they existed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-recall-src-'));
    const dbPath = path.join(dir, 'old.db');
    try {
      const old = new Database(dbPath);
      old.exec(`CREATE TABLE memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, value TEXT NOT NULL,
        type TEXT NOT NULL, project_id TEXT, file_path TEXT, timestamp INTEGER NOT NULL,
        access_count INTEGER DEFAULT 0, last_accessed INTEGER, relevance_score REAL DEFAULT 1.0,
        preference_key TEXT, is_active BOOLEAN DEFAULT 1, superseded_by TEXT, superseded_at INTEGER,
        confidence_score REAL)`);
      old.prepare('INSERT INTO memories (key, value, type, timestamp) VALUES (?, ?, ?, ?)')
        .run('legacy', JSON.stringify({ content: 'legacy rule' }), 'preference', Date.now());
      old.close();

      const migrated = new MemoryStorage(dbPath);
      try {
        expect(migrated.retrieve('legacy')?.source_transcript).toBeNull();
        migrated.save({
          key: 'fresh',
          value: { content: 'fresh rule' },
          type: 'preference',
          source_transcript: TRANSCRIPT,
          source_excerpt: 'fresh words',
        });
        expect(migrated.retrieve('fresh')?.source_transcript).toBe(TRANSCRIPT);
        expect(migrated.retrieve('fresh')?.source_excerpt).toBe('fresh words');
      } finally {
        migrated.close();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('sanitizeSource', () => {
  it('keeps a well-formed source', () => {
    expect(sanitizeSource({ session: 'acb927f2-91d1', transcript: TRANSCRIPT, entry: '91bfcded-a32c' })).toEqual({
      source_session: 'acb927f2-91d1',
      source_transcript: TRANSCRIPT,
      source_entry: '91bfcded-a32c',
      source_excerpt: null,
    });
  });

  it('caps the excerpt and drops an empty one', () => {
    const long = 'x'.repeat(MAX_SOURCE_EXCERPT_CHARS + 50);
    expect(sanitizeSource({ excerpt: long }).source_excerpt).toHaveLength(MAX_SOURCE_EXCERPT_CHARS);
    expect(sanitizeSource({ excerpt: '   ' }).source_excerpt).toBeNull();
    expect(sanitizeSource({ excerpt: 7 as any }).source_excerpt).toBeNull();
  });

  it('drops a transcript that is relative or not a .jsonl', () => {
    expect(sanitizeSource({ transcript: 'projects/s.jsonl' }).source_transcript).toBeNull();
    expect(sanitizeSource({ transcript: '/etc/passwd' }).source_transcript).toBeNull();
    expect(sanitizeSource({ transcript: 42 as any }).source_transcript).toBeNull();
  });

  it('drops ids with characters outside the uuid alphabet', () => {
    const s = sanitizeSource({ session: '../../x', entry: 'a b' });
    expect(s.source_session).toBeNull();
    expect(s.source_entry).toBeNull();
  });

  it('returns all nulls for no source', () => {
    expect(sanitizeSource()).toEqual({ source_session: null, source_transcript: null, source_entry: null, source_excerpt: null });
  });
});

describe('hookSource', () => {
  it('reads the session and transcript from hook input, the uuid from the entry', () => {
    expect(hookSource({ session_id: 's1', transcript_path: TRANSCRIPT }, { uuid: 'e1' }, 'words')).toEqual({
      session: 's1',
      transcript: TRANSCRIPT,
      entry: 'e1',
      excerpt: 'words',
    });
  });

  it('tolerates missing input', () => {
    expect(hookSource(undefined)).toEqual({ session: undefined, transcript: undefined, entry: undefined, excerpt: undefined });
  });
});

describe('search_memory shows the source', () => {
  async function search(query: string): Promise<string> {
    const { MemoryService } = await import('../../src/services/memory');
    const { LoggingService } = await import('../../src/services/logging');
    const { MemoryTools } = await import('../../src/mcp/tools/memory-tools');
    const tools = new MemoryTools(MemoryService.getInstance(), LoggingService.getInstance());
    const tool = tools.getTools().find(t => t.name === 'search_memory')!;
    const res = await tool.handler({ query }, { sessionId: 'test-session' } as any);
    return res.results;
  }

  beforeEach(async () => {
    const { MemoryService } = await import('../../src/services/memory');
    (MemoryService.getInstance() as any).storage.getDatabase().prepare('DELETE FROM memories').run();
  });

  it('prints the transcript and entry under a captured memory', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-recall-src-'));
    const transcript = path.join(dir, 'session.jsonl');
    fs.writeFileSync(transcript, '{}\n');
    try {
      const { MemoryService } = await import('../../src/services/memory');
      MemoryService.getInstance().store({
        key: 'with-source',
        value: { content: 'zebrafish builds use the release profile' },
        type: 'devops',
        source: { session: 's1', transcript, entry: 'e1', excerpt: 'zebrafish: always release profile' },
      });
      const out = await search('zebrafish');
      expect(out).toContain('zebrafish builds use the release profile');
      expect(out).toContain(`  source: ${transcript}, entry e1`);
      expect(out).not.toContain("user's words");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('quotes the saved excerpt once the transcript is deleted', async () => {
    const { MemoryService } = await import('../../src/services/memory');
    MemoryService.getInstance().store({
      key: 'gone-source',
      value: { content: 'narwhal releases are tagged by hand' },
      type: 'devops',
      source: { session: 's1', transcript: TRANSCRIPT, entry: 'e1', excerpt: 'tag narwhal releases by hand please' },
    });
    const out = await search('narwhal');
    expect(out).not.toContain(TRANSCRIPT);
    expect(out).toContain(`  source (transcript deleted; user's words): "tag narwhal releases by hand please"`);
  });

  it('prints no source line for a memory without one', async () => {
    const { MemoryService } = await import('../../src/services/memory');
    MemoryService.getInstance().store({
      key: 'no-source',
      value: { content: 'quokka deploys go through staging first' },
      type: 'devops',
    });
    const out = await search('quokka');
    expect(out).toContain('quokka deploys go through staging first');
    expect(out).not.toContain('source:');
  });
});

describe('formatSource', () => {
  it('prints nothing for a deleted transcript with no excerpt', () => {
    expect(formatSource({ source_transcript: TRANSCRIPT, source_entry: 'e1' })).toBe('');
  });

  it('shortens a long excerpt', () => {
    const out = formatSource({ source_excerpt: 'y'.repeat(800) });
    expect(out).toContain('y'.repeat(500) + '…');
    expect(out).not.toContain('y'.repeat(501));
  });
});
