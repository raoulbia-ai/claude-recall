import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MemoryService } from '../../src/services/memory';
import { OutcomeStorage, failureKey } from '../../src/services/outcome-storage';

const mockHint = jest.fn();
jest.mock('../../src/hooks/llm-classifier', () => ({
  extractHindsightHint: (...args: unknown[]) => mockHint(...args),
}));

let dbPath = ':memory:';
jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getDatabasePath: () => dbPath,
      getProjectId: () => 'proj',
      getConfig: () => ({
        database: { compaction: { maxMemories: 10000 } },
        project: { rootDir: '/tmp' },
        citations: {},
      }),
    }),
  },
}));
jest.mock('../../src/services/logging', () => ({
  LoggingService: {
    getInstance: () => ({
      info: jest.fn(), debug: jest.fn(), error: jest.fn(),
      logMemoryOperation: jest.fn(), logRetrieval: jest.fn(), logServiceError: jest.fn(),
    }),
  },
}));

import { generateCandidateLessons } from '../../src/hooks/memory-stop-hook';

/**
 * A lesson gains evidence when its failure is seen again, and is promoted on
 * the second sighting. Lessons used to be recognised by their text alone — and
 * a model asked twice about one failure does not answer in the same words.
 *
 * These are verbatim: claude-sonnet-5, asked through `extractHindsightHint`
 * about the same three failures, twice. By the store's own measure the two
 * answers to each are 0.45, 0.52 and 0.33 alike, against a threshold of 0.6 —
 * so every repeat was filed as a new lesson and nothing was promoted.
 */
const SESSIONS = [
  {
    "cargo": "Before running cargo commands, verify the Rust toolchain is installed and on PATH (e.g., `command -v cargo` or `rustup show`); if missing, install Rust/cargo or source the correct environment (e.g., `$HOME/.cargo/env`) before invoking cargo subcommands like clippy.",
    "psql": "Before running psql or other DB client commands against a host/port, verify the target server is running and listening on that port (e.g. check process status or use netstat/lsof), rather than assuming connectivity.",
    "python": "Before importing or referencing a module, verify it is installed (pip show/list) or present in the project; install it or correct the module name before running dependent code."
  },
  {
    "cargo": "Before running cargo/rustc commands, verify Rust toolchain is installed (e.g., `which cargo` or check `~/.cargo/bin` is in PATH) and if missing, install via rustup or report the environment limitation instead of assuming availability.",
    "psql": "Before running psql commands, verify the target Postgres server is running and listening on the expected host/port (e.g., check process status or use pg_isready), and start/configure it if not, instead of assuming connectivity.",
    "python": "Before importing a module in Python, verify it is installed (pip show/pip list or check requirements.txt) or install it first; do not assume shim/helper modules exist without confirming via file search or package listing."
  }
];

const DEFAULT_REMEDY = 'Check command syntax, file paths, and prerequisites before running';
const failure = (command: string, remedy = DEFAULT_REMEDY) => ({
  signal: 'non-zero-exit',
  confidence: 0.85,
  content: {
    what_failed: `Command failed: ${command}`,
    why_failed: 'Exit code 1',
    what_should_do: remedy,
    context: 'Bash command returned non-zero exit code 1',
  },
}) as any;

const FAILURES = [
  failure('cargo clippy --manifest-path /srv/billing/Cargo.toml'),
  failure("psql -h 127.0.0.1 -p 59999 -c 'select 1'"),
  failure("python3 -c 'import httpx_webhooks_shim'"),
];

/** The model, answering session `n` in that session's own words. */
function modelOfSession(n: number) {
  return async (whatFailed: string) => {
    const topic = (['cargo', 'psql', 'python'] as const).find(t => whatFailed.includes(t))!;
    return { hint_text: SESSIONS[n][topic], hint_kind: 'failure_preventer', applies_when: [topic] };
  };
}

const lessons = () => OutcomeStorage.getInstance().getCandidateLessons('proj')
  .map(l => ({ text: l.lesson_text, evidence: l.evidence_count, key: l.failure_key }));

beforeEach(() => {
  dbPath = ':memory:';
  (MemoryService as any).instance = undefined;
  OutcomeStorage.resetInstance();
  mockHint.mockReset();
});

afterEach(() => {
  try { MemoryService.getInstance().close(); } catch { /* already closed */ }
});

describe('a lesson is filed under the failure it came from', () => {
  it('recognises the same failure in a second session, however the model words it', async () => {
    mockHint.mockImplementation(modelOfSession(0));
    await generateCandidateLessons(FAILURES, 'ep1', 'proj');
    mockHint.mockImplementation(modelOfSession(1));
    await generateCandidateLessons(FAILURES, 'ep2', 'proj');

    // Three failures, three lessons, each seen twice — which is what promotion
    // waits for. Before: six lessons, each seen once.
    expect(lessons()).toEqual([
      { text: SESSIONS[0].cargo, evidence: 2, key: FAILURES[0].content.what_failed },
      { text: SESSIONS[0].psql, evidence: 2, key: FAILURES[1].content.what_failed },
      { text: SESSIONS[0].python, evidence: 2, key: FAILURES[2].content.what_failed },
    ]);
  });

  it('does not ask the model about a failure it already has a lesson for', async () => {
    mockHint.mockImplementation(modelOfSession(0));
    await generateCandidateLessons(FAILURES, 'ep1', 'proj');
    expect(mockHint).toHaveBeenCalledTimes(3);

    await generateCandidateLessons(FAILURES, 'ep2', 'proj');

    // The answer could only have been thrown away.
    expect(mockHint).toHaveBeenCalledTimes(3);
  });

  it('keeps a different failure a different lesson', async () => {
    mockHint.mockImplementation(modelOfSession(0));

    await generateCandidateLessons(FAILURES.slice(0, 2), 'ep1', 'proj');

    expect(lessons().map(l => l.evidence)).toEqual([1, 1]);
  });

  it('still counts the same advice reached from a different failure, as it always has', async () => {
    // Text similarity is kept as the fallback: two failures that teach one
    // thing are evidence for that thing.
    mockHint.mockResolvedValue({ hint_text: 'start the local database before running integration tests', hint_kind: 'rule', applies_when: [] });

    await generateCandidateLessons([failure('npm run test:integration'), failure('pytest tests/integration')], 'ep1', 'proj');

    expect(lessons()).toEqual([
      { text: 'start the local database before running integration tests', evidence: 2, key: 'Command failed: npm run test:integration' },
    ]);
  });

  it('reads the same command as the same failure whatever its spacing', async () => {
    expect(failureKey('  Command failed:  npm   test\n')).toBe(failureKey('Command failed: npm test'));
    expect(failureKey('Command failed: npm test')).not.toBe(failureKey('Command failed: npm Test'));

    // And the store applies it on both sides, so callers never have to.
    mockHint.mockResolvedValue({ hint_text: 'run the suite from the repo root', hint_kind: 'rule', applies_when: [] });
    await generateCandidateLessons([failure('npm   test')], 'ep1', 'proj');
    expect(OutcomeStorage.getInstance().findLessonForFailure(' Command failed: npm test ', 'proj'))
      .toMatchObject({ failure_key: 'Command failed: npm test' });
  });
});

describe('a failure whose description does not say what failed', () => {
  /** A failure as the detectors and the PostToolUseFailure hook describe it. */
  const described = (signal: string, whatFailed: string, whyFailed: string, confidence = 0.8) => ({
    signal,
    confidence,
    content: { what_failed: whatFailed, why_failed: whyFailed, what_should_do: 'Check inputs and prerequisites before retrying', context: 'ctx' },
  }) as any;

  /** A model that words its hindsight from the error it was shown. */
  const hindsightFromTheError = async (description: string) => ({
    hint_text: /ENOENT/.test(description)
      ? 'confirm a file exists with a glob before reading it by a guessed path'
      : 'read large generated files in ranges rather than whole, they exceed the size limit',
    hint_kind: 'failure_preventer',
    applies_when: [],
  });

  it('is not mistaken for every other failure of the same tool', async () => {
    // "Read failed" is all the description says. Two unrelated failed Reads
    // must not become one lesson seen twice — that would promote the first
    // one's advice the second time any Read failed.
    mockHint.mockImplementation(hindsightFromTheError);

    await generateCandidateLessons([described('tool_failure', 'Read failed', 'ENOENT: no such file /srv/app/config.yaml')], 'ep1', 'proj');
    await generateCandidateLessons([described('tool_failure', 'Read failed', 'File content exceeds maximum allowed size')], 'ep2', 'proj');

    expect(lessons().map(l => ({ evidence: l.evidence, key: l.key }))).toEqual([
      { evidence: 1, key: null },
      { evidence: 1, key: null },
    ]);
  });

  it.each([
    ['a retry loop', 'retry-loop', 'Bash called 3 times with identical arguments'],
    ['an edit-test cycle', 'edit-test-cycle', 'Edit-test cycle repeated 3 times on parser.ts'],
    ['a tool failure with nothing recorded', 'tool_failure', 'Tool failure'],
  ])('leaves %s unkeyed', async (_what, signal, whatFailed) => {
    mockHint.mockResolvedValue({ hint_text: `advice for ${signal}`, hint_kind: 'rule', applies_when: [] });

    await generateCandidateLessons([described(signal, whatFailed, 'why')], 'ep1', 'proj');

    expect(lessons()).toEqual([{ text: `advice for ${signal}`, evidence: 1, key: null }]);
  });

  it.each([
    ['a failed command', 'tool_failure', 'Bash command failed: terraform plan -var-file=staging.tfvars'],
    ['a failed edit', 'tool_failure', 'Edit failed on src/services/config.ts'],
    ['tests failing behind exit 0', 'silent-test-failure', 'Test command reported failures: npm test'],
  ])('files %s under what it names', async (_what, signal, whatFailed) => {
    mockHint.mockImplementation(async () => ({
      hint_text: `advice, worded ${mockHint.mock.calls.length} way`, hint_kind: 'rule', applies_when: [],
    }));

    await generateCandidateLessons([described(signal, whatFailed, 'why')], 'ep1', 'proj');
    await generateCandidateLessons([described(signal, whatFailed, 'why')], 'ep2', 'proj');

    expect(lessons()).toEqual([{ text: 'advice, worded 1 way', evidence: 2, key: whatFailed }]);
    expect(mockHint).toHaveBeenCalledTimes(1);
  });
});

describe('a lesson that only restates its failure', () => {
  it('is asked about again, and takes the model\'s words when it has some', async () => {
    // First sighting with no model to ask — past the hint budget, or timed out.
    mockHint.mockResolvedValue(null);
    await generateCandidateLessons([FAILURES[0]], 'ep1', 'proj');
    expect(lessons()[0].text).toBe(`${DEFAULT_REMEDY} (failure: ${FAILURES[0].content.what_failed})`);

    mockHint.mockImplementation(modelOfSession(0));
    await generateCandidateLessons([FAILURES[0]], 'ep2', 'proj');

    // One lesson, seen twice, and what gets promoted is the hindsight.
    expect(lessons()).toEqual([
      { text: SESSIONS[0].cargo, evidence: 2, key: FAILURES[0].content.what_failed },
    ]);
  });

  it('still gains evidence when the model has nothing to add', async () => {
    mockHint.mockResolvedValue(null);
    await generateCandidateLessons([FAILURES[0]], 'ep1', 'proj');
    await generateCandidateLessons([FAILURES[0]], 'ep2', 'proj');

    expect(lessons()).toHaveLength(1);
    expect(lessons()[0].evidence).toBe(2);
  });

  it('is left alone once promoted — its words are already a rule', async () => {
    mockHint.mockResolvedValue(null);
    await generateCandidateLessons([FAILURES[0]], 'ep1', 'proj');
    const [row] = OutcomeStorage.getInstance().getCandidateLessons('proj');
    OutcomeStorage.getInstance().updateLessonStatus(row.id, 'promoted', 'promoted_1');
    mockHint.mockClear();
    mockHint.mockImplementation(modelOfSession(0));

    await generateCandidateLessons([FAILURES[0]], 'ep2', 'proj');

    expect(mockHint).not.toHaveBeenCalled();
    expect(lessons()[0]).toMatchObject({ evidence: 2, text: expect.stringContaining('(failure: ') });
  });
});

describe('rewording', () => {
  it('never touches a lesson that has been promoted', () => {
    // Its words were copied into a rule when it was promoted; changing them
    // here would leave the two saying different things.
    const storage = OutcomeStorage.getInstance();
    const id = storage.createCandidateLesson({
      project_id: 'proj', lesson_text: 'the promoted words', lesson_kind: 'rule',
      outcome_type: 'negative', reward_band: -1, confidence: 0.85, durability: 'project',
    });
    storage.updateLessonStatus(id, 'promoted', 'promoted_1');

    storage.rewordLesson(id, 'different words', 'workflow', ['x']);

    expect(storage.getCandidateLessonById(id)).toMatchObject({ lesson_text: 'the promoted words', lesson_kind: 'rule' });
  });
});

describe('lessons recorded before failures were keyed', () => {
  it('still match by their text', async () => {
    const storage = OutcomeStorage.getInstance();
    storage.createCandidateLesson({
      project_id: 'proj', lesson_text: SESSIONS[0].cargo, lesson_kind: 'failure_preventer',
      outcome_type: 'negative', reward_band: -1, confidence: 0.85, durability: 'project',
    });
    mockHint.mockResolvedValue({ hint_text: SESSIONS[0].cargo, hint_kind: 'failure_preventer', applies_when: [] });

    await generateCandidateLessons([FAILURES[0]], 'ep2', 'proj');

    expect(lessons()).toEqual([{ text: SESSIONS[0].cargo, evidence: 2, key: null }]);
  });

  it('gain the column when an existing database is opened', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-lessons-'));
    try {
      dbPath = path.join(dir, 'claude-recall.db');
      // A database as 0.47.0 leaves it: the table, without the column.
      const old = new Database(dbPath);
      old.exec(`CREATE TABLE candidate_lessons (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, episode_id TEXT, lesson_text TEXT NOT NULL,
        lesson_kind TEXT NOT NULL, applies_when_json TEXT, outcome_type TEXT NOT NULL, reward_band INTEGER,
        confidence REAL NOT NULL, durability TEXT NOT NULL, evidence_count INTEGER DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'candidate', promoted_memory_key TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      old.prepare(`INSERT INTO candidate_lessons VALUES ('old-1','proj',NULL,'an old lesson','rule',NULL,'negative',-1,0.8,'project',1,'candidate',NULL,'2026-01-01','2026-01-01')`).run();
      old.close();

      const storage = OutcomeStorage.getInstance();

      expect(storage.getCandidateLessons('proj')).toEqual([
        expect.objectContaining({ id: 'old-1', lesson_text: 'an old lesson', failure_key: null }),
      ]);
      expect(storage.findLessonForFailure('Command failed: npm test', 'proj')).toBeNull();
    } finally {
      try { MemoryService.getInstance().close(); } catch { /* already closed */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
