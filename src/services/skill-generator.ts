import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { MemoryStorage, Memory } from '../memory/storage';
import { ConfigService } from './config';
import { LoggingService } from './logging';

export interface TopicConfig {
  id: string;
  displayName: string;
  description: string;
  memoryType: string;
  devopsCategory?: string;
  threshold: number;
  skillDir: string;
}

export interface SkillManifest {
  topicId: string;
  sourceHash: string;
  memoryCount: number;
  generatedAt: string;
  memoryKeys: string[];
}

export interface GenerationResult {
  topicId: string;
  action: 'created' | 'updated' | 'unchanged' | 'skipped';
  memoryCount: number;
  skillPath?: string;
}

const TOPICS: TopicConfig[] = [
  {
    id: 'corrections',
    displayName: 'Corrections',
    description: 'Learned corrections from past mistakes',
    memoryType: 'correction',
    threshold: 3,
    skillDir: 'auto-corrections'
  },
  {
    id: 'failure-lessons',
    displayName: 'Failure Lessons',
    description: 'Lessons learned from failures and what to do instead',
    memoryType: 'failure',
    threshold: 3,
    skillDir: 'auto-failure-lessons'
  },
  {
    id: 'preferences',
    displayName: 'Preferences',
    description: 'User preferences and coding conventions',
    memoryType: 'preference',
    threshold: 5,
    skillDir: 'auto-preferences'
  },
  {
    id: 'devops-git',
    displayName: 'Git Workflow',
    description: 'Git workflow patterns and conventions',
    memoryType: 'devops',
    devopsCategory: 'git_workflow',
    threshold: 3,
    skillDir: 'auto-devops-git'
  },
  {
    id: 'devops-testing',
    displayName: 'Testing Strategies',
    description: 'Testing approaches and conventions',
    memoryType: 'devops',
    devopsCategory: 'testing_approach',
    threshold: 3,
    skillDir: 'auto-devops-testing'
  },
  {
    id: 'devops-architecture',
    displayName: 'Architecture Decisions',
    description: 'Architecture patterns and decisions',
    memoryType: 'devops',
    devopsCategory: 'architecture',
    threshold: 3,
    skillDir: 'auto-devops-architecture'
  },
  {
    id: 'devops-build',
    displayName: 'Build & Deploy',
    description: 'Build and deployment patterns',
    memoryType: 'devops',
    devopsCategory: 'build_deploy',
    threshold: 3,
    skillDir: 'auto-devops-build'
  },
  {
    id: 'devops-workflow',
    displayName: 'Workflow Rules',
    description: 'Development workflow rules and conventions',
    memoryType: 'devops',
    devopsCategory: 'workflow_rule',
    threshold: 3,
    skillDir: 'auto-devops-workflow'
  },
  {
    id: 'devops-environment',
    displayName: 'Dev Environment',
    description: 'Development environment setup and configuration',
    memoryType: 'devops',
    devopsCategory: 'dev_environment',
    threshold: 3,
    skillDir: 'auto-devops-environment'
  },
  {
    id: 'devops-stack',
    displayName: 'Tech Stack',
    description: 'Technology stack choices and rationale',
    memoryType: 'devops',
    devopsCategory: 'tech_stack',
    threshold: 3,
    skillDir: 'auto-devops-stack'
  }
];

export class SkillGenerator {
  private static instance: SkillGenerator;
  private storage: MemoryStorage;
  private logger: LoggingService;

  private constructor() {
    const config = ConfigService.getInstance();
    this.storage = new MemoryStorage(config.getDatabasePath());
    this.logger = LoggingService.getInstance();
  }

  static getInstance(): SkillGenerator {
    if (!SkillGenerator.instance) {
      SkillGenerator.instance = new SkillGenerator();
    }
    return SkillGenerator.instance;
  }

  /**
   * Reset singleton (for testing)
   */
  static resetInstance(): void {
    SkillGenerator.instance = undefined as any;
  }

  /**
   * Create instance with a specific storage (for testing)
   */
  static createWithStorage(storage: MemoryStorage): SkillGenerator {
    const instance = new SkillGenerator();
    (instance as any).storage = storage;
    SkillGenerator.instance = instance;
    return instance;
  }

  /**
   * Get all configured topics
   */
  static getTopics(): TopicConfig[] {
    return [...TOPICS];
  }

  /**
   * Auto-trigger entry point: check thresholds and generate if needed
   */
  checkAndGenerate(projectDir: string, projectId?: string): GenerationResult[] {
    const results: GenerationResult[] = [];

    for (const topic of TOPICS) {
      const memories = this.getMemoriesForTopic(topic, projectId);
      if (memories.length >= topic.threshold) {
        const result = this.generateTopic(topic.id, projectDir, false, projectId);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Generate all qualifying skills
   */
  generateAll(projectDir: string, force: boolean = false, projectId?: string): GenerationResult[] {
    const results: GenerationResult[] = [];

    for (const topic of TOPICS) {
      const result = this.generateTopic(topic.id, projectDir, force, projectId);
      results.push(result);
    }

    return results;
  }

  /**
   * Generate a skill for a specific topic
   */
  generateTopic(topicId: string, projectDir: string, force: boolean = false, projectId?: string): GenerationResult {
    const topic = TOPICS.find(t => t.id === topicId);
    if (!topic) {
      return { topicId, action: 'skipped', memoryCount: 0 };
    }

    const memories = this.getMemoriesForTopic(topic, projectId);

    if (memories.length < topic.threshold) {
      return { topicId, action: 'skipped', memoryCount: memories.length };
    }

    const sourceHash = this.computeSourceHash(memories);
    const skillDir = path.join(projectDir, '.claude', 'skills', topic.skillDir);
    const manifest = this.readManifest(skillDir);

    if (!force && manifest && manifest.sourceHash === sourceHash) {
      return { topicId, action: 'unchanged', memoryCount: memories.length };
    }

    const markdown = this.renderSkillMarkdown(topic, memories);

    // Write SKILL.md
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), markdown);

    // Write manifest
    const newManifest: SkillManifest = {
      topicId,
      sourceHash,
      memoryCount: memories.length,
      generatedAt: new Date().toISOString(),
      memoryKeys: memories.map(m => m.key)
    };
    this.writeManifest(skillDir, newManifest);

    const action = manifest ? 'updated' : 'created';

    this.logger.info('SkillGenerator', `Skill ${action}: ${topic.skillDir}`, {
      topicId,
      memoryCount: memories.length,
      action
    });

    return {
      topicId,
      action,
      memoryCount: memories.length,
      skillPath: path.join(skillDir, 'SKILL.md')
    };
  }

  /**
   * Get topics that have enough memories to generate
   */
  getReadyTopics(projectId?: string): { topic: TopicConfig; count: number }[] {
    const ready: { topic: TopicConfig; count: number }[] = [];

    for (const topic of TOPICS) {
      const memories = this.getMemoriesForTopic(topic, projectId);
      if (memories.length >= topic.threshold) {
        ready.push({ topic, count: memories.length });
      }
    }

    return ready;
  }

  /**
   * List all generated skills in a project
   */
  listGeneratedSkills(projectDir: string): { topicId: string; skillDir: string; manifest: SkillManifest }[] {
    const skillsBase = path.join(projectDir, '.claude', 'skills');
    const results: { topicId: string; skillDir: string; manifest: SkillManifest }[] = [];

    for (const topic of TOPICS) {
      const skillDir = path.join(skillsBase, topic.skillDir);
      const manifest = this.readManifest(skillDir);
      if (manifest) {
        results.push({
          topicId: topic.id,
          skillDir: topic.skillDir,
          manifest
        });
      }
    }

    return results;
  }

  /**
   * Remove all auto-generated skills from a project
   */
  cleanGeneratedSkills(projectDir: string): string[] {
    const skillsBase = path.join(projectDir, '.claude', 'skills');
    const removed: string[] = [];

    for (const topic of TOPICS) {
      const skillDir = path.join(skillsBase, topic.skillDir);
      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true });
        removed.push(topic.skillDir);
      }
    }

    return removed;
  }

  /**
   * Get memories for a topic, filtered by type and optionally devops category
   */
  private getMemoriesForTopic(topic: TopicConfig, projectId?: string): Memory[] {
    const searchContext: { project_id?: string; type: string } = {
      type: topic.memoryType
    };

    if (projectId) {
      searchContext.project_id = projectId;
    }

    let memories = this.storage.searchByContext(searchContext);

    // Filter by devops category if specified
    if (topic.devopsCategory) {
      memories = memories.filter(m => {
        const val = typeof m.value === 'string' ? safeJsonParse(m.value) : m.value;
        return val && val.category === topic.devopsCategory;
      });
    }

    // Only include active memories
    memories = memories.filter(m => m.is_active !== false);

    return memories;
  }

  /**
   * Render SKILL.md content for a topic
   */
  renderSkillMarkdown(topic: TopicConfig, memories: Memory[]): string {
    const date = new Date().toISOString().split('T')[0];
    const rules = memories.map(m => this.formatRule(topic, m));

    const lines = [
      '---',
      `name: ${topic.skillDir}`,
      `description: ${topic.description}`,
      'version: "1.0.0"',
      'auto-generated: true',
      'source: claude-recall',
      '---',
      '',
      `# ${topic.displayName}`,
      '',
      `Auto-generated from ${memories.length} memories. Last updated: ${date}.`,
      '',
      '## Rules',
      '',
      ...rules,
      '',
      '---',
      '*Auto-generated by Claude Recall. Regenerate: `npx claude-recall skills generate`*',
      ''
    ];

    return lines.join('\n');
  }

  /**
   * Format a single rule based on topic type
   */
  private formatRule(topic: TopicConfig, memory: Memory): string {
    const displayValue = this.extractDisplayValue(memory);

    switch (topic.memoryType) {
      case 'correction':
        return `- CORRECTION: ${displayValue}`;
      case 'failure':
        return this.formatFailureRule(memory);
      case 'preference':
        return this.formatPreferenceRule(memory, displayValue);
      default:
        return `- ${displayValue}`;
    }
  }

  /**
   * Format a failure memory as a rule
   */
  private formatFailureRule(memory: Memory): string {
    const val = typeof memory.value === 'string' ? safeJsonParse(memory.value) : memory.value;
    const content = val?.content;

    if (content && typeof content === 'object' && content.what_failed && content.what_should_do) {
      return `- Avoid: ${content.what_failed} → Instead: ${content.what_should_do}`;
    }

    return `- ${this.extractDisplayValue(memory)}`;
  }

  /**
   * Format a preference memory as a rule
   */
  private formatPreferenceRule(memory: Memory, displayValue: string): string {
    const key = memory.preference_key;
    if (key && !key.startsWith('memory_') && !key.startsWith('auto_') && !key.startsWith('pref_')) {
      return `- ${key}: ${displayValue}`;
    }
    return `- ${displayValue}`;
  }

  /**
   * Extract a human-readable display value from a memory
   */
  extractDisplayValue(memory: Memory): string {
    const val = memory.value;

    // 1. String → return as-is
    if (typeof val === 'string') {
      return val;
    }

    if (typeof val !== 'object' || val === null) {
      return JSON.stringify(val);
    }

    // 2. { content: string } → return content
    if (typeof val.content === 'string') {
      return val.content;
    }

    // 3. { content: { what_failed, what_should_do } } → format as failure
    if (val.content && typeof val.content === 'object') {
      const c = val.content;
      if (c.what_failed && c.what_should_do) {
        return `${c.what_failed} → ${c.what_should_do}`;
      }
      if (c.what_failed) return c.what_failed;
      if (c.what_should_do) return c.what_should_do;
    }

    // 4. { category, value } → return value (devops)
    if (val.category && val.value) {
      return typeof val.value === 'string' ? val.value : JSON.stringify(val.value);
    }

    // 5. { value: string } → return value (preference)
    if (typeof val.value === 'string') {
      return val.value;
    }

    // Fallback
    return JSON.stringify(val);
  }

  /**
   * Compute a SHA-256 hash of the sorted memory keys + values for change detection
   */
  private computeSourceHash(memories: Memory[]): string {
    const sorted = [...memories].sort((a, b) => a.key.localeCompare(b.key));
    const data = sorted.map(m => ({
      key: m.key,
      value: m.value,
      type: m.type
    }));

    const canonical = JSON.stringify(data);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Read manifest.json from a skill directory
   */
  private readManifest(skillDir: string): SkillManifest | null {
    const manifestPath = path.join(skillDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Write manifest.json to a skill directory
   */
  private writeManifest(skillDir: string, manifest: SkillManifest): void {
    fs.writeFileSync(
      path.join(skillDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );
  }
}

/**
 * Safely parse JSON, returning null on failure
 */
function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}
