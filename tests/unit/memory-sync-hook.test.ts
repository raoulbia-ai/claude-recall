import * as fs from 'fs';
import * as path from 'path';

// Must mock os before any imports that use it
let mockHomeDir = '/tmp/memory-sync-test-default';
jest.mock('os', () => {
  const actual = jest.requireActual('os');
  return {
    ...actual,
    homedir: () => mockHomeDir,
    tmpdir: actual.tmpdir,
  };
});

jest.mock('../../src/services/memory');
jest.mock('../../src/services/config');

import { handleMemorySync, deriveAutoMemoryPath } from '../../src/hooks/memory-sync-hook';
import { MemoryService, SyncRule } from '../../src/services/memory';
import { ConfigService } from '../../src/services/config';

function makeSyncRule(overrides: Partial<SyncRule> & { key: string; value: any }): SyncRule {
  return {
    crType: 'preference',
    ccType: 'feedback',
    score: 1,
    cite_count: 0,
    load_count: 1,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('memory-sync-hook', () => {
  let tmpDir: string;
  let memoryDir: string;
  let mockGetTopRulesForSync: jest.Mock;
  let mockLoadActiveRules: jest.Mock;
  const testCwd = '/home/user/project';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync('/tmp/memory-sync-test-');
    mockHomeDir = tmpDir;

    const sanitized = testCwd.replace(/\//g, '-');
    memoryDir = path.join(tmpDir, '.claude', 'projects', sanitized, 'memory');

    (ConfigService.getInstance as jest.Mock).mockReturnValue({
      getProjectId: jest.fn().mockReturnValue('test-project'),
    });

    mockGetTopRulesForSync = jest.fn().mockReturnValue([]);
    mockLoadActiveRules = jest.fn().mockReturnValue({
      preferences: [], corrections: [], failures: [], devops: [], summary: '',
    });
    (MemoryService.getInstance as jest.Mock).mockReturnValue({
      getTopRulesForSync: mockGetTopRulesForSync,
      loadActiveRules: mockLoadActiveRules,
    });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('deriveAutoMemoryPath', () => {
    it('should derive correct path from cwd', () => {
      const result = deriveAutoMemoryPath('/home/user/projects/my-app');
      expect(result).toBe(
        path.join(tmpDir, '.claude', 'projects', '-home-user-projects-my-app', 'memory')
      );
    });

    it('should handle root path', () => {
      const result = deriveAutoMemoryPath('/');
      expect(result).toBe(
        path.join(tmpDir, '.claude', 'projects', '-', 'memory')
      );
    });
  });

  describe('handleMemorySync', () => {
    // --- Individual file generation ---

    it('writes individual .md files with YAML frontmatter', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'pref_1', value: 'Use TypeScript strict mode', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(1);

      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('---');
      expect(content).toContain('name:');
      expect(content).toContain('description:');
      expect(content).toContain('type: feedback');
      expect(content).toContain('Use TypeScript strict mode');
    });

    it('maps correction type to feedback', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'corr_1', value: 'Do not use var', crType: 'correction', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('type: feedback');
      expect(content).toContain('Correction:');
    });

    it('maps devops type to project', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'devops_1', value: 'Always run tests before commit', crType: 'devops', ccType: 'project' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('type: project');
    });

    it('maps project-knowledge type to project', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'pk_1', value: 'API uses REST not GraphQL', crType: 'project-knowledge', ccType: 'project' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('type: project');
    });

    it('maps failure type to feedback', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'fail_1', value: 'npm test fails without NODE_ENV', crType: 'failure', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('type: feedback');
      expect(content).toContain('Failure lesson:');
    });

    // --- Multiple rules ---

    it('writes multiple files for multiple rules', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p1', value: 'Use tabs', crType: 'preference', ccType: 'feedback' }),
        makeSyncRule({ key: 'p2', value: 'Prefer functional style', crType: 'preference', ccType: 'feedback' }),
        makeSyncRule({ key: 'd1', value: 'Run lint before push', crType: 'devops', ccType: 'project' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(3);
    });

    // --- MEMORY.md index ---

    it('updates MEMORY.md with per-file pointers', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p1', value: 'Use TypeScript', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const memoryMd = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      expect(memoryMd).toContain('## Claude Recall');
      expect(memoryMd).toMatch(/\[.*\]\(recall_.*\.md\)/); // markdown link to recall file
    });

    it('preserves existing MEMORY.md content', async () => {
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '# My Notes\n\n- Important thing\n');

      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p1', value: 'Use TS', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const memoryMd = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      expect(memoryMd).toContain('# My Notes');
      expect(memoryMd).toContain('- Important thing');
      expect(memoryMd).toContain('## Claude Recall');
    });

    it('replaces Claude Recall section on re-run (no duplication)', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p1', value: 'Old rule', crType: 'preference', ccType: 'feedback' }),
      ]);
      await handleMemorySync({ cwd: testCwd });

      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p2', value: 'New rule', crType: 'preference', ccType: 'feedback' }),
      ]);
      await handleMemorySync({ cwd: testCwd });

      const memoryMd = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      const sections = memoryMd.match(/## Claude Recall/g);
      expect(sections).toHaveLength(1);
    });

    // --- Cleanup ---

    it('removes old recall-rules.md on first sync', async () => {
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, 'recall-rules.md'), '# Old flat file\n');

      await handleMemorySync({ cwd: testCwd });

      expect(fs.existsSync(path.join(memoryDir, 'recall-rules.md'))).toBe(false);
    });

    it('cleans up stale recall_* files from previous syncs', async () => {
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, 'recall_feedback_old-rule.md'), 'stale');

      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p1', value: 'New rule only', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      // Old file should be gone
      expect(fs.existsSync(path.join(memoryDir, 'recall_feedback_old-rule.md'))).toBe(false);
      // New file should exist
      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(1);
    });

    it('does not remove non-recall files', async () => {
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, 'user_role.md'), 'CC own memory');

      await handleMemorySync({ cwd: testCwd });

      expect(fs.existsSync(path.join(memoryDir, 'user_role.md'))).toBe(true);
    });

    // --- Filtering ---

    it('filters out test data keys', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'Test preference', value: 'test value', crType: 'preference', ccType: 'feedback' }),
        makeSyncRule({ key: 'real_pref', value: 'Keep this', crType: 'preference', ccType: 'feedback' }),
        makeSyncRule({ key: 'test_key', value: 'another test', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(1);

      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('Keep this');
    });

    it('filters out values containing secrets', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'safe', value: 'Use prettier', crType: 'preference', ccType: 'feedback' }),
        makeSyncRule({ key: 'unsafe_1', value: 'api_key=abc123', crType: 'preference', ccType: 'feedback' }),
        makeSyncRule({ key: 'unsafe_2', value: 'Set password to admin', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(1);

      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('Use prettier');
    });

    // --- Cap ---

    it('respects getTopRulesForSync limit (30 max)', async () => {
      // getTopRulesForSync already caps at 30 — verify the hook writes exactly what it returns
      const rules = Array.from({ length: 30 }, (_, i) =>
        makeSyncRule({ key: `rule_${i}`, value: `Rule number ${i}`, crType: 'preference', ccType: 'feedback' })
      );
      mockGetTopRulesForSync.mockReturnValue(rules);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(30);
    });

    // --- Empty rules ---

    it('writes no recall files for empty rules', async () => {
      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(0);
    });

    it('writes MEMORY.md with empty section for no rules', async () => {
      await handleMemorySync({ cwd: testCwd });

      const memoryMd = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      expect(memoryMd).toContain('## Claude Recall');
      expect(memoryMd).toContain('No recall rules synced');
    });

    // --- Idempotency ---

    it('is idempotent — re-run produces same files', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p1', value: 'Use tabs', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });
      const files1 = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content1 = fs.readFileSync(path.join(memoryDir, files1[0]), 'utf-8');

      await handleMemorySync({ cwd: testCwd });
      const files2 = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content2 = fs.readFileSync(path.join(memoryDir, files2[0]), 'utf-8');

      expect(files1).toEqual(files2);
      expect(content1).toEqual(content2);
    });

    // --- Edge cases ---

    it('handles missing cwd gracefully', async () => {
      await expect(handleMemorySync({})).resolves.not.toThrow();
      await expect(handleMemorySync({ cwd: '' })).resolves.not.toThrow();
      await expect(handleMemorySync(null)).resolves.not.toThrow();
    });

    it('creates auto-memory directory if missing', async () => {
      expect(fs.existsSync(memoryDir)).toBe(false);

      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'p1', value: 'Use TS', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      expect(fs.existsSync(memoryDir)).toBe(true);
    });

    it('handles object values correctly', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({
          key: 'p1',
          value: { content: 'Prefer functional style', confidence: 0.9 },
          crType: 'preference',
          ccType: 'feedback',
        }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('Prefer functional style');
    });

    it('handles human-readable keys as names', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'coding-style', value: 'Use functional patterns', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      const content = fs.readFileSync(path.join(memoryDir, files[0]), 'utf-8');
      expect(content).toContain('name: Coding Style');
    });

    it('deduplicates filenames for rules with same slug', async () => {
      mockGetTopRulesForSync.mockReturnValue([
        makeSyncRule({ key: 'hook_1', value: 'Use tabs', crType: 'preference', ccType: 'feedback' }),
        makeSyncRule({ key: 'hook_2', value: 'Use tabs', crType: 'preference', ccType: 'feedback' }),
      ]);

      await handleMemorySync({ cwd: testCwd });

      const files = fs.readdirSync(memoryDir).filter(f => f.startsWith('recall_'));
      expect(files).toHaveLength(2);
      // Filenames should be different
      expect(files[0]).not.toBe(files[1]);
    });
  });
});
