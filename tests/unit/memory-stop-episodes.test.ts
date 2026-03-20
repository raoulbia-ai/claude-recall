import { MemoryService } from '../../src/services/memory';
import { OutcomeStorage } from '../../src/services/outcome-storage';

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

describe('Memory Stop Episodes', () => {
  beforeEach(() => {
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

  describe('episode creation + update flow', () => {
    it('should create episode and update with outcome', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      const episodeId = outcomeStorage.createEpisode({
        project_id: 'test-project',
        session_id: 'session-1',
        source: 'memory-stop',
      });

      expect(episodeId).toBeDefined();

      outcomeStorage.updateEpisode(episodeId, {
        outcome_type: 'failure',
        severity: 'medium',
        outcome_summary: '2 memories, 1 failure',
      });

      const db = MemoryService.getInstance().getDatabase();
      const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as any;
      expect(row.outcome_type).toBe('failure');
      expect(row.severity).toBe('medium');
      expect(row.outcome_summary).toBe('2 memories, 1 failure');
    });
  });

  describe('candidate lesson generation from failures', () => {
    it('should create candidate lesson for high-confidence failure', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const episodeId = outcomeStorage.createEpisode({ project_id: 'test-project' });

      outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        episode_id: episodeId,
        lesson_text: 'Check command syntax before running',
        lesson_kind: 'failure_preventer',
        applies_when: ['bash', 'command'],
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.85,
        durability: 'project',
      });

      const lessons = outcomeStorage.getCandidateLessons('test-project', 'candidate');
      expect(lessons.length).toBe(1);
      expect(lessons[0].lesson_text).toBe('Check command syntax before running');
      expect(lessons[0].episode_id).toBe(episodeId);
    });
  });

  describe('evidence count incrementing for similar lessons', () => {
    it('should increment evidence when similar lesson exists', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      const id = outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Always check file paths exist before operations',
        lesson_kind: 'failure_preventer',
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.8,
        durability: 'project',
      });

      // Simulate finding similar and incrementing
      const similar = outcomeStorage.findSimilarLessons(
        'Always check file paths exist before operations',
        'test-project'
      );
      expect(similar.length).toBe(1);

      outcomeStorage.incrementEvidenceCount(similar[0].id);
      const updated = outcomeStorage.getCandidateLessonById(id);
      expect(updated!.evidence_count).toBe(2);
    });

    it('should not match dissimilar lessons', () => {
      const outcomeStorage = OutcomeStorage.getInstance();

      outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Use TypeScript strict mode for all new files',
        lesson_kind: 'preference',
        outcome_type: 'positive',
        reward_band: 1,
        confidence: 0.9,
        durability: 'global',
      });

      const similar = outcomeStorage.findSimilarLessons(
        'Check database connection before queries',
        'test-project'
      );
      expect(similar.length).toBe(0);
    });
  });

  describe('reask signal outcome events', () => {
    it('should store reask signal events', () => {
      const outcomeStorage = OutcomeStorage.getInstance();
      const db = MemoryService.getInstance().getDatabase();

      outcomeStorage.createOutcomeEvent({
        event_type: 'reask_signal',
        actor: 'user',
        action_summary: 'User said: that didn\'t work',
        next_state_summary: 'User expressed dissatisfaction with previous approach',
      });

      const events = db.prepare(
        "SELECT * FROM outcome_events WHERE event_type = 'reask_signal'"
      ).all() as any[];

      expect(events.length).toBe(1);
      expect(events[0].actor).toBe('user');
    });
  });
});
