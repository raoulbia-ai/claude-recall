/**
 * Memory janitor — the LLM-driven hygiene pass.
 *
 * Critical properties under test:
 *  - claim-on-check rate limiting (one run per interval across sessions)
 *  - the recursion guard (nested headless sessions never run hygiene)
 *  - STRICT validation of LLM output (unknown ids, malformed JSON, and
 *    over-cap action lists must never mutate the corpus)
 *  - replacement-first apply order (merge/rewrite store before demoting)
 *  - dry-run mutates nothing
 *  - grace period keeps fresh memories out of the review entirely
 */

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockGetActiveRules = jest.fn();
const mockDemoteByIds = jest.fn();
jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      getStorage: () => ({
        getActiveRules: mockGetActiveRules,
        demoteRulesByIds: mockDemoteByIds,
      }),
    }),
  },
}));

jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => 'janitor-test-project',
      getDatabasePath: () => ':memory:',
      getConfig: () => ({ database: {} }),
      getLogPath: (n: string) => `/tmp/janitor-test-${n}`,
    }),
  },
}));

const mockStoreMemory = jest.fn();
jest.mock('../../src/hooks/shared', () => ({
  ...jest.requireActual('../../src/hooks/shared'),
  storeMemory: (...args: any[]) => mockStoreMemory(...args),
}));

jest.mock('../../src/mcp/tools/memory-tools', () => ({
  formatRuleValue: (v: any) => (typeof v === 'string' ? v : v?.content ?? JSON.stringify(v)),
}));

const mockCcComplete = jest.fn();
jest.mock('../../src/hooks/cc-classifier', () => ({
  completeWithClaudeCli: (...args: any[]) => mockCcComplete(...args),
}));

const mockKiroComplete = jest.fn();
jest.mock('../../src/hooks/kiro-classifier', () => ({
  completeWithKiroCli: (...args: any[]) => mockKiroComplete(...args),
}));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  claimJanitorRun,
  maybeSpawnJanitor,
  parseJanitorActions,
  applyJanitorActions,
  dropCosmeticRewrites,
  handleMemoryJanitorWorker,
  buildJanitorPrompt,
} from '../../src/hooks/memory-janitor';

// State files live under CLAUDE_RECALL_DB_PATH (hookStateDir) — isolate from
// the developer's real ~/.claude-recall.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-janitor-'));
let originalDbPath: string | undefined;

const HOUR = 3600000;
const DAY = 24 * HOUR;

function fakeChild() {
  return {
    on: jest.fn(),
    stdin: { on: jest.fn(), write: jest.fn(), end: jest.fn() },
    unref: jest.fn(),
    pid: 4242,
  };
}

function resetState(): void {
  fs.rmSync(path.join(TMP, 'hook-state'), { recursive: true, force: true });
}

function rule(id: number, ageMs: number, text: string, type = 'preference') {
  return {
    id,
    key: `hook_${type}_${id}`,
    type,
    value: JSON.stringify({ content: text }),
    load_count: 10,
    cite_count: 0,
    timestamp: Date.now() - ageMs,
  };
}

beforeAll(() => {
  originalDbPath = process.env.CLAUDE_RECALL_DB_PATH;
  process.env.CLAUDE_RECALL_DB_PATH = TMP;
});

afterAll(() => {
  if (originalDbPath === undefined) delete process.env.CLAUDE_RECALL_DB_PATH;
  else process.env.CLAUDE_RECALL_DB_PATH = originalDbPath;
  fs.rmSync(TMP, { recursive: true, force: true });
});

beforeEach(() => {
  mockSpawn.mockReset().mockReturnValue(fakeChild());
  mockGetActiveRules.mockReset();
  mockDemoteByIds.mockReset().mockReturnValue(1);
  mockStoreMemory.mockReset();
  mockCcComplete.mockReset();
  mockKiroComplete.mockReset();
  resetState();
  delete process.env.CLAUDE_RECALL_JANITOR;
  delete process.env.CLAUDE_RECALL_JANITOR_INTERVAL_HOURS;
  delete process.env.CLAUDE_RECALL_JANITOR_GRACE_HOURS;
  delete process.env.CLAUDE_RECALL_JANITOR_WORKER;
  delete process.env.CLAUDE_RECALL_JANITOR_RUNTIME;
  delete process.env.CLAUDE_RECALL_NESTED;
  delete process.env.CLAUDE_RECALL_CC_CLASSIFIER;
  delete process.env.CLAUDE_RECALL_KIRO_CLASSIFIER;
});

describe('claimJanitorRun', () => {
  it('grants the first claim and refuses a second within the interval', () => {
    expect(claimJanitorRun(1000000000)).toBe(true);
    expect(claimJanitorRun(1000000000 + HOUR)).toBe(false);
  });

  it('grants again after the interval elapses', () => {
    expect(claimJanitorRun(1000000000)).toBe(true);
    expect(claimJanitorRun(1000000000 + 25 * HOUR)).toBe(true);
  });

  it('honors CLAUDE_RECALL_JANITOR_INTERVAL_HOURS', () => {
    process.env.CLAUDE_RECALL_JANITOR_INTERVAL_HOURS = '1';
    expect(claimJanitorRun(1000000000)).toBe(true);
    expect(claimJanitorRun(1000000000 + 2 * HOUR)).toBe(true);
  });

  it('treats a corrupt state file as never-ran', () => {
    expect(claimJanitorRun(1000000000)).toBe(true);
    fs.writeFileSync(path.join(TMP, 'hook-state', 'janitor-state.json'), 'not json');
    expect(claimJanitorRun(1000000000 + HOUR)).toBe(true);
  });
});

describe('maybeSpawnJanitor', () => {
  it('spawns the detached worker with the runtime marker', () => {
    maybeSpawnJanitor({ cwd: '/tmp/proj' }, 'kiro');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [, args, opts] = mockSpawn.mock.calls[0];
    expect(args).toContain('memory-janitor-worker');
    expect(opts.detached).toBe(true);
    expect(opts.env.CLAUDE_RECALL_JANITOR_RUNTIME).toBe('kiro');
  });

  it('does not spawn twice within the interval (claim-on-check)', () => {
    maybeSpawnJanitor({}, 'cc');
    maybeSpawnJanitor({}, 'cc');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('is disabled by CLAUDE_RECALL_JANITOR=off', () => {
    process.env.CLAUDE_RECALL_JANITOR = 'off';
    maybeSpawnJanitor({}, 'cc');
    expect(mockSpawn).not.toHaveBeenCalled();
    // and it must not even claim state — a later enable should run
    expect(fs.existsSync(path.join(TMP, 'hook-state', 'janitor-state.json'))).toBe(false);
  });

  it('refuses to run from any nested headless session', () => {
    for (const flag of [
      'CLAUDE_RECALL_NESTED',
      'CLAUDE_RECALL_CC_CLASSIFIER',
      'CLAUDE_RECALL_KIRO_CLASSIFIER',
      'CLAUDE_RECALL_JANITOR_WORKER',
    ]) {
      resetState();
      process.env[flag] = '1';
      maybeSpawnJanitor({}, 'cc');
      delete process.env[flag];
    }
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});

describe('parseJanitorActions', () => {
  const VALID = new Set([1, 2, 3, 4, 5]);

  it('accepts a valid mixed action set', () => {
    const raw = JSON.stringify({
      actions: [
        { action: 'demote', ids: [1], reason: 'conversational fragment' },
        { action: 'merge', ids: [2, 3], replacement: 'Check preconditions before retrying commands', reason: 'duplicates' },
        { action: 'rewrite', ids: [4], replacement: 'When creating email files, name them email_*.txt', reason: 'vague' },
      ],
    });
    const actions = parseJanitorActions(raw, VALID);
    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatchObject({ action: 'demote', ids: [1] });
  });

  it('strips markdown fences and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n{"actions":[{"action":"demote","ids":[1],"reason":"noise"}]}\n```';
    expect(parseJanitorActions(raw, VALID)).toHaveLength(1);
  });

  it('drops ids not in the reviewed set', () => {
    const raw = JSON.stringify({ actions: [{ action: 'demote', ids: [99], reason: 'x' }] });
    expect(parseJanitorActions(raw, VALID)).toHaveLength(0);
  });

  it('drops a merge with fewer than 2 ids or a bad replacement', () => {
    const short = JSON.stringify({ actions: [{ action: 'merge', ids: [1], replacement: 'valid replacement text', reason: 'x' }] });
    expect(parseJanitorActions(short, VALID)).toHaveLength(0);
    const noRepl = JSON.stringify({ actions: [{ action: 'merge', ids: [1, 2], replacement: 'tiny', reason: 'x' }] });
    expect(parseJanitorActions(noRepl, VALID)).toHaveLength(0);
  });

  it('drops a rewrite targeting more than one id', () => {
    const raw = JSON.stringify({ actions: [{ action: 'rewrite', ids: [1, 2], replacement: 'a precise enough rule text', reason: 'x' }] });
    expect(parseJanitorActions(raw, VALID)).toHaveLength(0);
  });

  it('caps the total number of actions', () => {
    const actions = Array.from({ length: 20 }, (_, i) => ({
      action: 'demote', ids: [(i % 5) + 1], reason: 'noise',
    }));
    expect(parseJanitorActions(JSON.stringify({ actions }), VALID)).toHaveLength(10);
  });

  it('returns [] for malformed output, never throws', () => {
    expect(parseJanitorActions('total garbage', VALID)).toHaveLength(0);
    expect(parseJanitorActions('{"actions": "nope"}', VALID)).toHaveLength(0);
    expect(parseJanitorActions('', VALID)).toHaveLength(0);
  });
});

describe('applyJanitorActions', () => {
  const rulesById = new Map([
    [1, { id: 1, type: 'preference' }],
    [2, { id: 2, type: 'failure' }],
    [3, { id: 3, type: 'failure' }],
  ]);

  it('demotes with the janitor sentinel', () => {
    const results = applyJanitorActions(
      [{ action: 'demote', ids: [1], reason: 'noise' }], rulesById,
    );
    expect(mockDemoteByIds).toHaveBeenCalledWith([1], 'janitor');
    expect(results[0].applied).toBe(true);
  });

  it('merge stores the replacement BEFORE demoting the sources', () => {
    const order: string[] = [];
    mockStoreMemory.mockImplementation(() => order.push('store'));
    mockDemoteByIds.mockImplementation(() => { order.push('demote'); return 2; });
    applyJanitorActions(
      [{ action: 'merge', ids: [2, 3], replacement: 'One consolidated failure lesson', reason: 'dups' }],
      rulesById,
    );
    expect(order).toEqual(['store', 'demote']);
    expect(mockStoreMemory).toHaveBeenCalledWith('One consolidated failure lesson', 'failure', undefined, 0.9);
  });

  it('a failing store leaves the originals untouched', () => {
    mockStoreMemory.mockImplementation(() => { throw new Error('disk full'); });
    const results = applyJanitorActions(
      [{ action: 'rewrite', ids: [1], replacement: 'A precise version of the rule', reason: 'vague' }],
      rulesById,
    );
    expect(mockDemoteByIds).not.toHaveBeenCalled();
    expect(results[0].applied).toBe(false);
  });

  it('dry-run mutates nothing', () => {
    const results = applyJanitorActions(
      [{ action: 'demote', ids: [1], reason: 'noise' }], rulesById, { dryRun: true },
    );
    expect(mockDemoteByIds).not.toHaveBeenCalled();
    expect(mockStoreMemory).not.toHaveBeenCalled();
    expect(results[0].applied).toBe(true);
  });
});

describe('handleMemoryJanitorWorker', () => {
  it('skips (null) when fewer than 2 rules survive the grace period', async () => {
    mockGetActiveRules.mockReturnValue([
      rule(1, 2 * DAY, 'Use pnpm not npm'),
      rule(2, HOUR, 'brand new — inside grace'),
    ]);
    const report = await handleMemoryJanitorWorker({}, { runtime: 'cc' });
    expect(report).toBeNull();
    expect(mockCcComplete).not.toHaveBeenCalled();
  });

  it('reviews only rules past the grace period and applies validated actions', async () => {
    mockGetActiveRules.mockReturnValue([
      rule(1, 3 * DAY, 'Check inputs and prerequisites before retrying'),
      rule(2, 3 * DAY, 'Check inputs and prerequisites before retrying commands', 'failure'),
      rule(3, HOUR, 'fresh rule — must not be reviewable'),
    ]);
    mockCcComplete.mockResolvedValue(JSON.stringify({
      actions: [
        { action: 'demote', ids: [1], reason: 'platitude' },
        { action: 'demote', ids: [3], reason: 'should be dropped — inside grace' },
      ],
    }));
    const report = await handleMemoryJanitorWorker({}, { runtime: 'cc' });
    expect(report?.reviewed).toBe(2);
    expect(report?.actions).toHaveLength(1); // id 3 not a valid target
    expect(mockDemoteByIds).toHaveBeenCalledWith([1], 'janitor');
    // the fresh rule's text must not even reach the LLM
    expect(mockCcComplete.mock.calls[0][0]).not.toContain('fresh rule');
  });

  it('routes to the Kiro backend when runtime=kiro', async () => {
    mockGetActiveRules.mockReturnValue([rule(1, 3 * DAY, 'a'), rule(2, 3 * DAY, 'b')]);
    mockKiroComplete.mockResolvedValue('{"actions":[]}');
    await handleMemoryJanitorWorker({}, { runtime: 'kiro' });
    expect(mockKiroComplete).toHaveBeenCalledTimes(1);
    expect(mockCcComplete).not.toHaveBeenCalled();
  });

  it('is a no-op when the LLM backend is unavailable', async () => {
    mockGetActiveRules.mockReturnValue([rule(1, 3 * DAY, 'a'), rule(2, 3 * DAY, 'b')]);
    mockCcComplete.mockResolvedValue(null);
    const report = await handleMemoryJanitorWorker({}, { runtime: 'cc' });
    expect(report).toBeNull();
    expect(mockDemoteByIds).not.toHaveBeenCalled();
  });

  it('malformed LLM output produces an empty-action report, no mutation', async () => {
    mockGetActiveRules.mockReturnValue([rule(1, 3 * DAY, 'a'), rule(2, 3 * DAY, 'b')]);
    mockCcComplete.mockResolvedValue('I refuse to answer in JSON today.');
    const report = await handleMemoryJanitorWorker({}, { runtime: 'cc' });
    expect(report?.actions).toHaveLength(0);
    expect(mockDemoteByIds).not.toHaveBeenCalled();
  });

  it('writes a report file readable afterwards', async () => {
    mockGetActiveRules.mockReturnValue([rule(1, 3 * DAY, 'a'), rule(2, 3 * DAY, 'b')]);
    mockCcComplete.mockResolvedValue('{"actions":[{"action":"demote","ids":[2],"reason":"noise"}]}');
    await handleMemoryJanitorWorker({}, { runtime: 'cc' });
    const report = JSON.parse(
      fs.readFileSync(path.join(TMP, 'hook-state', 'janitor-last-report.json'), 'utf-8'),
    );
    expect(report.reviewed).toBe(2);
    expect(report.actions[0]).toMatchObject({ action: 'demote', ids: [2], applied: true });
  });

  it('dry-run flows through to apply', async () => {
    mockGetActiveRules.mockReturnValue([rule(1, 3 * DAY, 'a'), rule(2, 3 * DAY, 'b')]);
    mockCcComplete.mockResolvedValue('{"actions":[{"action":"demote","ids":[1],"reason":"noise"}]}');
    const report = await handleMemoryJanitorWorker({}, { runtime: 'cc', dryRun: true });
    expect(report?.dryRun).toBe(true);
    expect(mockDemoteByIds).not.toHaveBeenCalled();
  });
});

describe('buildJanitorPrompt', () => {
  it('demands strict JSON and includes every rule line', () => {
    const prompt = buildJanitorPrompt(['{"id":1}', '{"id":2}']);
    expect(prompt).toContain('ONLY minified JSON');
    expect(prompt).toContain('{"id":1}');
    expect(prompt).toContain('{"id":2}');
    expect(prompt).toContain('empty actions array is a valid answer');
  });

  it('forbids cosmetic rewrites of already-precise rules', () => {
    const prompt = buildJanitorPrompt(['{"id":1}']);
    expect(prompt).toContain('ALREADY precise, do not rewrite');
    expect(prompt).toContain('not an action');
  });
});

describe('dropCosmeticRewrites', () => {
  const textById = new Map([
    [1, 'When creating email text files, name them with the email_ prefix'],
    [2, 'name docs so they sort together'],
  ]);

  it('drops a rewrite that only shuffles the original wording', () => {
    const actions = dropCosmeticRewrites([{
      action: 'rewrite' as const,
      ids: [1],
      replacement: 'When creating email text files, name them with the email_ prefix always',
      reason: 'minor clarification only',
    }], textById);
    expect(actions).toHaveLength(0);
  });

  it('keeps a rewrite that genuinely changes the rule text', () => {
    const actions = dropCosmeticRewrites([{
      action: 'rewrite' as const,
      ids: [2],
      replacement: 'When creating a new doc file, match the naming prefix of similar files — email files are email_*.txt',
      reason: 'vague, no trigger',
    }], textById);
    expect(actions).toHaveLength(1);
  });

  it('never touches demote or merge actions', () => {
    const actions = dropCosmeticRewrites([
      { action: 'demote' as const, ids: [1], reason: 'noise' },
      { action: 'merge' as const, ids: [1, 2], replacement: 'merged rule text here', reason: 'dups' },
    ], textById);
    expect(actions).toHaveLength(2);
  });
});
