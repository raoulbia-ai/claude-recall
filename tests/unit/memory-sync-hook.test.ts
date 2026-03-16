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
import { MemoryService } from '../../src/services/memory';
import { ConfigService } from '../../src/services/config';

describe('memory-sync-hook', () => {
  let tmpDir: string;
  let memoryDir: string;
  let mockLoadActiveRules: jest.Mock;
  const testCwd = '/home/user/project';

  beforeEach(() => {
    // Create a unique tmp directory for each test
    tmpDir = fs.mkdtempSync('/tmp/memory-sync-test-');
    mockHomeDir = tmpDir;

    const sanitized = testCwd.replace(/\//g, '-');
    memoryDir = path.join(tmpDir, '.claude', 'projects', sanitized, 'memory');

    (ConfigService.getInstance as jest.Mock).mockReturnValue({
      getProjectId: jest.fn().mockReturnValue('test-project'),
    });

    mockLoadActiveRules = jest.fn().mockReturnValue({
      preferences: [],
      corrections: [],
      failures: [],
      devops: [],
      summary: 'No active rules found',
    });
    (MemoryService.getInstance as jest.Mock).mockReturnValue({
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
    it('should export rules to recall-rules.md with correct sections', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [
          { key: 'pref_1', value: { content: 'Use TypeScript' } },
          { key: 'coding-style', value: { content: 'Prefer functional style' } },
        ],
        corrections: [
          { key: 'corr_1', value: { content: 'Do not use var' } },
        ],
        failures: [
          { key: 'fail_1', value: { content: 'REST failed, use GraphQL' } },
        ],
        devops: [
          { key: 'devops_1', value: { content: 'Always run tests before commit' } },
        ],
        summary: 'Loaded rules',
      });

      await handleMemorySync({ cwd: testCwd });

      const rulesPath = path.join(memoryDir, 'recall-rules.md');
      expect(fs.existsSync(rulesPath)).toBe(true);

      const content = fs.readFileSync(rulesPath, 'utf-8');
      expect(content).toContain('# Claude Recall Rules');
      expect(content).toContain('## Preferences');
      expect(content).toContain('- Use TypeScript');
      expect(content).toContain('- coding-style: Prefer functional style');
      expect(content).toContain('## Corrections');
      expect(content).toContain('- Do not use var');
      expect(content).toContain('## Failures');
      expect(content).toContain('- REST failed, use GraphQL');
      expect(content).toContain('## DevOps Rules');
      expect(content).toContain('- Always run tests before commit');
      expect(content).toContain('*Last synced:');
    });

    it('should filter out test data keys', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [
          { key: 'Test preference', value: { content: 'test value' } },
          { key: 'real_pref', value: { content: 'Keep this' } },
          { key: 'Session test 123', value: { content: 'session test' } },
          { key: 'test_key', value: { content: 'another test' } },
        ],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      await handleMemorySync({ cwd: testCwd });

      const content = fs.readFileSync(path.join(memoryDir, 'recall-rules.md'), 'utf-8');
      expect(content).toContain('Keep this');
      expect(content).not.toContain('test value');
      expect(content).not.toContain('session test');
      expect(content).not.toContain('another test');
    });

    it('should filter out values containing secrets', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [
          { key: 'safe', value: { content: 'Use prettier' } },
          { key: 'unsafe_1', value: { content: 'api_key=abc123' } },
          { key: 'unsafe_2', value: { content: 'Set password to admin' } },
          { key: 'unsafe_3', value: { content: 'Use token xyz for auth' } },
        ],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      await handleMemorySync({ cwd: testCwd });

      const content = fs.readFileSync(path.join(memoryDir, 'recall-rules.md'), 'utf-8');
      expect(content).toContain('Use prettier');
      expect(content).not.toContain('api_key=abc123');
      expect(content).not.toContain('password');
      expect(content).not.toContain('token xyz');
    });

    it('should add MEMORY.md pointer when missing', async () => {
      await handleMemorySync({ cwd: testCwd });

      const memoryMd = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      expect(memoryMd).toContain('recall-rules.md');
      expect(memoryMd).toContain('## Claude Recall');
    });

    it('should not duplicate MEMORY.md pointer on re-run', async () => {
      await handleMemorySync({ cwd: testCwd });
      await handleMemorySync({ cwd: testCwd });

      const memoryMd = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      // The pointer line contains recall-rules.md twice: [recall-rules.md](recall-rules.md)
      // So 2 matches means the pointer was appended exactly once
      const matches = memoryMd.match(/recall-rules\.md/g);
      expect(matches).toHaveLength(2);
    });

    it('should preserve existing MEMORY.md content', async () => {
      fs.mkdirSync(memoryDir, { recursive: true });
      fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '# My Notes\n\n- Important thing\n');

      await handleMemorySync({ cwd: testCwd });

      const memoryMd = fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf-8');
      expect(memoryMd).toContain('# My Notes');
      expect(memoryMd).toContain('- Important thing');
      expect(memoryMd).toContain('recall-rules.md');
    });

    it('should handle missing cwd gracefully', async () => {
      await expect(handleMemorySync({})).resolves.not.toThrow();
      await expect(handleMemorySync({ cwd: '' })).resolves.not.toThrow();
      await expect(handleMemorySync(null)).resolves.not.toThrow();
    });

    it('should produce minimal file for empty rules', async () => {
      await handleMemorySync({ cwd: testCwd });

      const content = fs.readFileSync(path.join(memoryDir, 'recall-rules.md'), 'utf-8');
      expect(content).toContain('# Claude Recall Rules');
      expect(content).toContain('*Last synced:');
      expect(content).not.toContain('## Preferences');
      expect(content).not.toContain('## Corrections');
    });

    it('should create auto-memory directory if missing', async () => {
      expect(fs.existsSync(memoryDir)).toBe(false);

      await handleMemorySync({ cwd: testCwd });

      expect(fs.existsSync(memoryDir)).toBe(true);
      expect(fs.existsSync(path.join(memoryDir, 'recall-rules.md'))).toBe(true);
    });

    it('should be idempotent — re-run overwrites with latest rules', async () => {
      mockLoadActiveRules.mockReturnValueOnce({
        preferences: [{ key: 'p1', value: { content: 'Old rule' } }],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      await handleMemorySync({ cwd: testCwd });
      let content = fs.readFileSync(path.join(memoryDir, 'recall-rules.md'), 'utf-8');
      expect(content).toContain('Old rule');

      mockLoadActiveRules.mockReturnValueOnce({
        preferences: [{ key: 'p1', value: { content: 'New rule' } }],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      await handleMemorySync({ cwd: testCwd });
      content = fs.readFileSync(path.join(memoryDir, 'recall-rules.md'), 'utf-8');
      expect(content).toContain('New rule');
      expect(content).not.toContain('Old rule');
    });
  });
});
