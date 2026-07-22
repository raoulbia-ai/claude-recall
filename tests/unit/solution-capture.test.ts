/**
 * Unit tests for the `solution` memory type (success-capture feature).
 *
 * Covers the deliberate-save path end to end: a stored `solution` is a
 * first-class active rule that loadActiveRules() surfaces in its own bucket
 * (which feeds every injection surface), and retrieval ranks solutions as
 * high-signal. The auto-capture LLM path is exercised separately; here we lock
 * the type plumbing that both paths depend on.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MemoryService } from '../../src/services/memory';
import { MemoryRetrieval } from '../../src/core/retrieval';

const PROJECT = 'solution-test-project';

const ENV_KEYS = [
  'CLAUDE_RECALL_DB_PATH',
  'CLAUDE_RECALL_LOG_DIR',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_PROJECT_ID',
] as const;

describe('solution memory type (success-capture)', () => {
  let testDir: string;
  let savedEnv: Record<string, string | undefined>;
  let service: MemoryService;

  beforeAll(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-recall-solution-'));
    process.env.CLAUDE_RECALL_DB_PATH = testDir;
    process.env.CLAUDE_RECALL_LOG_DIR = path.join(testDir, 'logs');
    process.env.CLAUDE_PROJECT_DIR = testDir;
    process.env.CLAUDE_PROJECT_ID = PROJECT;

    jest.resetModules();
    const mod = require('../../src/services/memory') as typeof import('../../src/services/memory');
    service = mod.MemoryService.getInstance();
  });

  afterAll(() => {
    service.close();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('loadActiveRules() returns a solutions bucket with active solution rows', () => {
    service.store({
      key: 'sol_1',
      value: { content: 'To submit to Kaggle programmatically, use `kaggle competitions submit -c <slug> -f <file> -m <msg>`' },
      type: 'solution',
    });

    const rules = service.loadActiveRules(PROJECT);
    expect(Array.isArray(rules.solutions)).toBe(true);
    expect(rules.solutions.some(m => m.key === 'sol_1')).toBe(true);
    expect(rules.summary).toContain('1 solutions');
  });

  it('demoting a solution (is_active=0) drops it from the bucket', () => {
    service.store({ key: 'sol_demote', value: { content: 'demote me' }, type: 'solution' });
    const before = service.loadActiveRules(PROJECT).solutions.some(m => m.key === 'sol_demote');
    expect(before).toBe(true);

    service.getDatabase().prepare('UPDATE memories SET is_active = 0 WHERE key = ?').run('sol_demote');

    const after = service.loadActiveRules(PROJECT).solutions.some(m => m.key === 'sol_demote');
    expect(after).toBe(false);
  });

  it('retrieval ranks `solution` as high-signal (above project-knowledge and preference)', () => {
    const priority = (MemoryRetrieval as any).TYPE_PRIORITY as Record<string, number>;
    expect(priority.solution).toBeGreaterThan(priority['project-knowledge']);
    expect(priority.solution).toBeGreaterThan(priority.preference);
    // but still below explicit user corrections
    expect(priority.solution).toBeLessThan(priority.correction);
  });

  it('a solution is a RULE type — searchable and scoped like other rules', () => {
    service.store({
      key: 'sol_scoped',
      value: { content: 'scoped solution fixture' },
      type: 'solution',
      context: { projectId: PROJECT },
    });
    const found = service.getAllByProject(PROJECT).find(m => m.key === 'sol_scoped');
    expect(found).toBeDefined();
    expect(found!.type).toBe('solution');
  });
});
