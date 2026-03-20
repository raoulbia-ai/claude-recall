import { MemoryStorage } from '../../src/memory/storage';
import { MemoryService } from '../../src/services/memory';
import { OutcomeStorage } from '../../src/services/outcome-storage';

// Mock ConfigService to use in-memory DB
jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getDatabasePath: () => ':memory:',
      getProjectId: () => 'test-project',
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
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      logMemoryOperation: jest.fn(),
      logRetrieval: jest.fn(),
      logServiceError: jest.fn(),
    }),
  },
}));

describe('OutcomeStorage', () => {
  beforeEach(() => {
    // Reset singletons for each test
    (MemoryService as any).instance = undefined;
    OutcomeStorage.resetInstance();
  });

  afterEach(() => {
    try {
      MemoryService.getInstance().close();
    } catch {}
    (MemoryService as any).instance = undefined;
    OutcomeStorage.resetInstance();
  });

  describe('table creation via migration', () => {
    it('should create all 4 outcome tables', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('episodes','outcome_events','candidate_lessons','memory_stats')"
      ).all() as Array<{ name: string }>;

      const tableNames = tables.map(t => t.name).sort();
      expect(tableNames).toEqual(['candidate_lessons', 'episodes', 'memory_stats', 'outcome_events']);
    });
  });

  describe('episodes CRUD', () => {
    it('should create and retrieve an episode', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      const id = outcomeStorage.createEpisode({
        project_id: 'test-project',
        session_id: 'session-1',
        source: 'test',
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as any;
      expect(row).toBeDefined();
      expect(row.project_id).toBe('test-project');
      expect(row.session_id).toBe('session-1');
      expect(row.source).toBe('test');
      expect(row.started_at).toBeDefined();
    });

    it('should update an episode', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      const id = outcomeStorage.createEpisode({
        project_id: 'test-project',
      });

      outcomeStorage.updateEpisode(id, {
        outcome_type: 'failure',
        severity: 'high',
        outcome_summary: '3 failures detected',
      });

      const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as any;
      expect(row.outcome_type).toBe('failure');
      expect(row.severity).toBe('high');
      expect(row.outcome_summary).toBe('3 failures detected');
      expect(row.ended_at).toBeDefined();
    });
  });

  describe('outcome_events CRUD', () => {
    it('should create an outcome event', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      const id = outcomeStorage.createOutcomeEvent({
        event_type: 'bash_result',
        actor: 'tool',
        action_summary: 'npm test',
        next_state_summary: 'Exit code 1: test failed',
        exit_code: 1,
        tags: ['npm', 'test'],
      });

      expect(id).toBeDefined();

      const row = db.prepare('SELECT * FROM outcome_events WHERE id = ?').get(id) as any;
      expect(row.event_type).toBe('bash_result');
      expect(row.actor).toBe('tool');
      expect(row.exit_code).toBe(1);
      expect(JSON.parse(row.tags_json)).toEqual(['npm', 'test']);
    });

    it('should create event with nullable episode_id', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      const id = outcomeStorage.createOutcomeEvent({
        event_type: 'bash_result',
        actor: 'tool',
        next_state_summary: 'Exit code 0',
      });

      const row = db.prepare('SELECT * FROM outcome_events WHERE id = ?').get(id) as any;
      expect(row.episode_id).toBeNull();
    });

    it('should link event to episode', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      const episodeId = outcomeStorage.createEpisode({ project_id: 'test' });
      const eventId = outcomeStorage.createOutcomeEvent({
        episode_id: episodeId,
        event_type: 'user_correction',
        actor: 'user',
        next_state_summary: 'User corrected approach',
      });

      const row = db.prepare('SELECT * FROM outcome_events WHERE id = ?').get(eventId) as any;
      expect(row.episode_id).toBe(episodeId);
    });
  });

  describe('candidate_lessons CRUD', () => {
    it('should create a candidate lesson', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      const id = outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Always check file exists before reading',
        lesson_kind: 'failure_preventer',
        applies_when: ['file-read', 'bash'],
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.85,
        durability: 'project',
      });

      expect(id).toBeDefined();

      const row = db.prepare('SELECT * FROM candidate_lessons WHERE id = ?').get(id) as any;
      expect(row.lesson_text).toBe('Always check file exists before reading');
      expect(row.lesson_kind).toBe('failure_preventer');
      expect(row.evidence_count).toBe(1);
      expect(row.status).toBe('candidate');
      expect(JSON.parse(row.applies_when_json)).toEqual(['file-read', 'bash']);
    });

    it('should update lesson status', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      const id = outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'test lesson',
        lesson_kind: 'rule',
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.8,
        durability: 'project',
      });

      outcomeStorage.updateLessonStatus(id, 'promoted', 'memory_key_123');

      const lesson = outcomeStorage.getCandidateLessonById(id);
      expect(lesson!.status).toBe('promoted');
      expect(lesson!.promoted_memory_key).toBe('memory_key_123');
    });
  });

  describe('findSimilarLessons dedup', () => {
    it('should find similar lessons by Jaccard similarity', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Check command syntax and file paths before running bash commands',
        lesson_kind: 'failure_preventer',
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.8,
        durability: 'project',
      });

      const similar = outcomeStorage.findSimilarLessons(
        'Check command syntax and file paths before running commands',
        'test-project'
      );

      expect(similar.length).toBe(1);
    });

    it('should not find dissimilar lessons', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Always use TypeScript strict mode',
        lesson_kind: 'preference',
        outcome_type: 'positive',
        reward_band: 1,
        confidence: 0.9,
        durability: 'global',
      });

      const similar = outcomeStorage.findSimilarLessons(
        'Check file permissions before writing',
        'test-project'
      );

      expect(similar.length).toBe(0);
    });
  });

  describe('incrementEvidenceCount', () => {
    it('should increment evidence count', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      const id = outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'test lesson',
        lesson_kind: 'rule',
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.8,
        durability: 'project',
      });

      expect(outcomeStorage.getCandidateLessonById(id)!.evidence_count).toBe(1);

      outcomeStorage.incrementEvidenceCount(id);
      expect(outcomeStorage.getCandidateLessonById(id)!.evidence_count).toBe(2);

      outcomeStorage.incrementEvidenceCount(id);
      expect(outcomeStorage.getCandidateLessonById(id)!.evidence_count).toBe(3);
    });
  });

  describe('memory_stats operations', () => {
    it('should record retrieval via upsert', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      outcomeStorage.recordRetrieval('mem-key-1');
      const stats = outcomeStorage.getMemoryStats('mem-key-1');

      expect(stats).toBeDefined();
      expect(stats!.times_retrieved).toBe(1);
      expect(stats!.last_retrieved_at).toBeDefined();
    });

    it('should increment retrieval count on subsequent calls', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      outcomeStorage.recordRetrieval('mem-key-2');
      outcomeStorage.recordRetrieval('mem-key-2');
      outcomeStorage.recordRetrieval('mem-key-2');

      const stats = outcomeStorage.getMemoryStats('mem-key-2');
      expect(stats!.times_retrieved).toBe(3);
    });

    it('should record helpful via upsert', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      outcomeStorage.recordHelpful('mem-key-3');
      const stats = outcomeStorage.getMemoryStats('mem-key-3');

      expect(stats!.times_helpful).toBe(1);
      expect(stats!.last_confirmed_at).toBeDefined();
    });

    it('should track retrieval and helpful independently', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      outcomeStorage.recordRetrieval('mem-key-4');
      outcomeStorage.recordRetrieval('mem-key-4');
      outcomeStorage.recordHelpful('mem-key-4');

      const stats = outcomeStorage.getMemoryStats('mem-key-4');
      expect(stats!.times_retrieved).toBe(2);
      expect(stats!.times_helpful).toBe(1);
    });

    it('should return null for unknown key', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const stats = outcomeStorage.getMemoryStats('nonexistent');
      expect(stats).toBeNull();
    });
  });
});
