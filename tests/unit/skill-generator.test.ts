import { MemoryStorage } from '../../src/memory/storage';
import { SkillGenerator } from '../../src/services/skill-generator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SkillGenerator', () => {
  let storage: MemoryStorage;
  let generator: SkillGenerator;
  let tmpDir: string;

  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
    generator = SkillGenerator.createWithStorage(storage);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-gen-test-'));
  });

  afterEach(() => {
    storage.close();
    SkillGenerator.resetInstance();
    // Clean up tmp dir
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  let uniqueCounter = 0;

  function storeMemories(type: string, count: number, extras?: Record<string, any>) {
    for (let i = 0; i < count; i++) {
      uniqueCounter++;
      storage.save({
        key: `${type}_${uniqueCounter}_${Date.now()}`,
        value: { content: `${type} rule ${uniqueCounter}`, ...extras },
        type,
        timestamp: Date.now() + uniqueCounter,
        is_active: true
      });
    }
  }

  describe('getReadyTopics', () => {
    it('should return empty when no memories exist', () => {
      const ready = generator.getReadyTopics();
      expect(ready).toHaveLength(0);
    });

    it('should return topics above threshold', () => {
      storeMemories('correction', 3);
      const ready = generator.getReadyTopics();
      expect(ready).toHaveLength(1);
      expect(ready[0].topic.id).toBe('corrections');
      expect(ready[0].count).toBe(3);
    });

    it('should not return topics below threshold', () => {
      storeMemories('correction', 2);
      const ready = generator.getReadyTopics();
      expect(ready).toHaveLength(0);
    });

    it('should require 5 preferences to be ready', () => {
      storeMemories('preference', 4);
      expect(generator.getReadyTopics()).toHaveLength(0);

      storeMemories('preference', 1);
      expect(generator.getReadyTopics()).toHaveLength(1);
    });

    it('should handle devops sub-categories', () => {
      // 3 git_workflow devops memories
      for (let i = 0; i < 3; i++) {
        storage.save({
          key: `devops_git_${i}_${Date.now()}`,
          value: { content: `git rule ${i}`, category: 'git_workflow' },
          type: 'devops',
          timestamp: Date.now() + i,
          is_active: true
        });
      }

      const ready = generator.getReadyTopics();
      expect(ready).toHaveLength(1);
      expect(ready[0].topic.id).toBe('devops-git');
    });

    it('should not mix devops categories', () => {
      // 2 git_workflow + 1 testing_approach = neither should be ready
      storage.save({
        key: 'devops_git_1',
        value: { content: 'git rule 1', category: 'git_workflow' },
        type: 'devops',
        is_active: true
      });
      storage.save({
        key: 'devops_git_2',
        value: { content: 'git rule 2', category: 'git_workflow' },
        type: 'devops',
        is_active: true
      });
      storage.save({
        key: 'devops_test_1',
        value: { content: 'test rule 1', category: 'testing_approach' },
        type: 'devops',
        is_active: true
      });

      const ready = generator.getReadyTopics();
      expect(ready).toHaveLength(0);
    });
  });

  describe('generateTopic', () => {
    it('should create SKILL.md and manifest.json for qualifying topic', () => {
      storeMemories('correction', 3);

      const result = generator.generateTopic('corrections', tmpDir);

      expect(result.action).toBe('created');
      expect(result.memoryCount).toBe(3);
      expect(result.skillPath).toBeDefined();

      // Check files exist
      const skillDir = path.join(tmpDir, '.claude', 'skills', 'auto-corrections');
      expect(fs.existsSync(path.join(skillDir, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(skillDir, 'manifest.json'))).toBe(true);

      // Check SKILL.md content
      const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
      expect(content).toContain('name: auto-corrections');
      expect(content).toContain('auto-generated: true');
      expect(content).toContain('CORRECTION:');
      expect(content).toMatch(/correction rule \d+/);
    });

    it('should return skipped for below-threshold topic', () => {
      storeMemories('correction', 2);

      const result = generator.generateTopic('corrections', tmpDir);

      expect(result.action).toBe('skipped');
      expect(result.memoryCount).toBe(2);
    });

    it('should return unchanged when content hash matches manifest', () => {
      storeMemories('correction', 3);

      // First generation
      const first = generator.generateTopic('corrections', tmpDir);
      expect(first.action).toBe('created');

      // Second generation with same content
      const second = generator.generateTopic('corrections', tmpDir);
      expect(second.action).toBe('unchanged');
    });

    it('should update when content has changed', () => {
      storeMemories('correction', 3);

      // First generation
      generator.generateTopic('corrections', tmpDir);

      // Add more memories
      storeMemories('correction', 1);

      // Second generation
      const result = generator.generateTopic('corrections', tmpDir);
      expect(result.action).toBe('updated');
      expect(result.memoryCount).toBe(4);
    });

    it('should regenerate with force even when unchanged', () => {
      storeMemories('correction', 3);

      generator.generateTopic('corrections', tmpDir);
      const result = generator.generateTopic('corrections', tmpDir, true);

      expect(result.action).toBe('updated');
    });

    it('should return skipped for unknown topic', () => {
      const result = generator.generateTopic('nonexistent', tmpDir);
      expect(result.action).toBe('skipped');
    });
  });

  describe('generateAll', () => {
    it('should generate only qualifying topics', () => {
      storeMemories('correction', 3);
      storeMemories('failure', 3);
      storeMemories('preference', 2); // Below threshold of 5

      const results = generator.generateAll(tmpDir);

      const created = results.filter(r => r.action === 'created');
      const skipped = results.filter(r => r.action === 'skipped');

      expect(created).toHaveLength(2);
      expect(created.map(r => r.topicId).sort()).toEqual(['corrections', 'failure-lessons']);
      expect(skipped.length).toBeGreaterThan(0);
    });
  });

  describe('renderSkillMarkdown', () => {
    it('should produce valid frontmatter and bullet points', () => {
      storeMemories('correction', 3);
      const topics = SkillGenerator.getTopics();
      const correctionTopic = topics.find(t => t.id === 'corrections')!;

      const memories = storage.searchByContext({ type: 'correction' });
      const markdown = generator.renderSkillMarkdown(correctionTopic, memories);

      // Check frontmatter
      expect(markdown).toMatch(/^---\n/);
      expect(markdown).toContain('name: auto-corrections');
      expect(markdown).toContain('auto-generated: true');
      expect(markdown).toContain('source: claude-recall');

      // Check content
      expect(markdown).toContain('# Corrections');
      expect(markdown).toContain('## Rules');
      expect(markdown).toContain('- CORRECTION:');

      // Check footer
      expect(markdown).toContain('Auto-generated by Claude Recall');
    });
  });

  describe('extractDisplayValue', () => {
    it('should handle string values', () => {
      const memory = { key: 'k', value: 'simple string', type: 'correction' };
      expect(generator.extractDisplayValue(memory as any)).toBe('simple string');
    });

    it('should handle { content: string }', () => {
      const memory = { key: 'k', value: { content: 'the content' }, type: 'correction' };
      expect(generator.extractDisplayValue(memory as any)).toBe('the content');
    });

    it('should handle failure format { content: { what_failed, what_should_do } }', () => {
      const memory = {
        key: 'k',
        value: {
          content: {
            what_failed: 'used localStorage',
            what_should_do: 'use httpOnly cookies'
          }
        },
        type: 'failure'
      };
      expect(generator.extractDisplayValue(memory as any)).toBe(
        'used localStorage → use httpOnly cookies'
      );
    });

    it('should handle devops format { category, value }', () => {
      const memory = {
        key: 'k',
        value: { category: 'git_workflow', value: 'always rebase' },
        type: 'devops'
      };
      expect(generator.extractDisplayValue(memory as any)).toBe('always rebase');
    });

    it('should handle { value: string }', () => {
      const memory = { key: 'k', value: { value: 'tabs over spaces' }, type: 'preference' };
      expect(generator.extractDisplayValue(memory as any)).toBe('tabs over spaces');
    });

    it('should fallback to JSON.stringify for unknown formats', () => {
      const memory = { key: 'k', value: { x: 1, y: 2 }, type: 'preference' };
      expect(generator.extractDisplayValue(memory as any)).toBe('{"x":1,"y":2}');
    });
  });

  describe('checkAndGenerate', () => {
    it('should only write when thresholds crossed AND content changed', () => {
      // Below threshold — nothing happens
      storeMemories('correction', 2);
      let results = generator.checkAndGenerate(tmpDir);
      expect(results).toHaveLength(0);

      // Cross threshold — skill created
      storeMemories('correction', 1);
      results = generator.checkAndGenerate(tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('created');

      // Same content — unchanged
      results = generator.checkAndGenerate(tmpDir);
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('unchanged');
    });
  });

  describe('listGeneratedSkills', () => {
    it('should list generated skills', () => {
      storeMemories('correction', 3);
      generator.generateTopic('corrections', tmpDir);

      const skills = generator.listGeneratedSkills(tmpDir);
      expect(skills).toHaveLength(1);
      expect(skills[0].topicId).toBe('corrections');
      expect(skills[0].manifest.memoryCount).toBe(3);
    });

    it('should return empty when no skills exist', () => {
      const skills = generator.listGeneratedSkills(tmpDir);
      expect(skills).toHaveLength(0);
    });
  });

  describe('cleanGeneratedSkills', () => {
    it('should remove all auto-generated skills', () => {
      storeMemories('correction', 3);
      storeMemories('failure', 3);
      generator.generateAll(tmpDir);

      const removed = generator.cleanGeneratedSkills(tmpDir);
      expect(removed).toHaveLength(2);
      expect(removed).toContain('auto-corrections');
      expect(removed).toContain('auto-failure-lessons');

      // Verify files are gone
      const skillsBase = path.join(tmpDir, '.claude', 'skills');
      expect(fs.existsSync(path.join(skillsBase, 'auto-corrections'))).toBe(false);
      expect(fs.existsSync(path.join(skillsBase, 'auto-failure-lessons'))).toBe(false);
    });
  });

  describe('inactive memories', () => {
    it('should exclude inactive memories from topic count', () => {
      // Store 3 corrections but mark one inactive
      storage.save({
        key: 'corr_active_1',
        value: { content: 'active rule 1' },
        type: 'correction',
        is_active: true
      });
      storage.save({
        key: 'corr_active_2',
        value: { content: 'active rule 2' },
        type: 'correction',
        is_active: true
      });
      storage.save({
        key: 'corr_inactive',
        value: { content: 'inactive rule' },
        type: 'correction',
        is_active: false
      });

      // Only 2 active = below threshold of 3
      const ready = generator.getReadyTopics();
      expect(ready).toHaveLength(0);
    });
  });

  describe('failure rule formatting', () => {
    it('should format failure memories with what_failed and what_should_do', () => {
      for (let i = 0; i < 3; i++) {
        storage.save({
          key: `failure_${i}`,
          value: {
            content: {
              what_failed: `approach ${i}`,
              what_should_do: `better approach ${i}`,
              why_failed: 'reasons'
            }
          },
          type: 'failure',
          is_active: true
        });
      }

      const result = generator.generateTopic('failure-lessons', tmpDir);
      expect(result.action).toBe('created');

      const content = fs.readFileSync(result.skillPath!, 'utf-8');
      expect(content).toContain('Avoid: approach 0');
      expect(content).toContain('Instead: better approach 0');
    });
  });

  describe('preference rule formatting', () => {
    it('should show preference key when it is meaningful', () => {
      for (let i = 0; i < 5; i++) {
        storage.save({
          key: `pref_${i}`,
          value: { content: `pref value ${i}` },
          type: 'preference',
          preference_key: i < 3 ? `coding_style_${i}` : undefined,
          is_active: true
        });
      }

      const result = generator.generateTopic('preferences', tmpDir);
      expect(result.action).toBe('created');

      const content = fs.readFileSync(result.skillPath!, 'utf-8');
      // Meaningful keys get "key: value" format
      expect(content).toContain('coding_style_0: pref value 0');
    });
  });
});
