import { MemoryService } from '../../src/services/memory';
import { OutcomeStorage, CandidateLesson, MemoryStats } from '../../src/services/outcome-storage';
import { PromotionEngine } from '../../src/services/promotion-engine';
import { Memory } from '../../src/memory/storage';

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

describe('PromotionEngine', () => {
  let engine: PromotionEngine;
  let outcomeStorage: OutcomeStorage;

  beforeEach(() => {
    (MemoryService as any).instance = undefined;
    OutcomeStorage.resetInstance();
    PromotionEngine.resetInstance();
    engine = PromotionEngine.getInstance();
    outcomeStorage = OutcomeStorage.getInstance();
  });

  afterEach(() => {
    try {
      MemoryService.getInstance().close();
    } catch {}
    (MemoryService as any).instance = undefined;
    OutcomeStorage.resetInstance();
    PromotionEngine.resetInstance();
  });

  describe('shouldPromote', () => {
    it('should promote when evidence_count >= 2', () => {
      const candidate = makeCandidateLesson({ evidence_count: 2, confidence: 0.7, reward_band: -1 });
      expect(engine.shouldPromote(candidate)).toBe(true);
    });

    it('should not promote with evidence_count = 1 and normal confidence', () => {
      const candidate = makeCandidateLesson({ evidence_count: 1, confidence: 0.7, reward_band: -1 });
      expect(engine.shouldPromote(candidate)).toBe(false);
    });

    it('should immediately promote high-severity failures', () => {
      const candidate = makeCandidateLesson({ evidence_count: 1, confidence: 0.9, reward_band: -2 });
      expect(engine.shouldPromote(candidate)).toBe(true);
    });

    it('should not immediately promote if confidence < 0.9', () => {
      const candidate = makeCandidateLesson({ evidence_count: 1, confidence: 0.85, reward_band: -2 });
      expect(engine.shouldPromote(candidate)).toBe(false);
    });
  });

  describe('shouldReject', () => {
    it('should reject stale single-observation candidates', () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const candidate = makeCandidateLesson({ evidence_count: 1, created_at: eightDaysAgo });
      expect(engine.shouldReject(candidate)).toBe(true);
    });

    it('should not reject recent candidates', () => {
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const candidate = makeCandidateLesson({ evidence_count: 1, created_at: oneDayAgo });
      expect(engine.shouldReject(candidate)).toBe(false);
    });

    it('should not reject if evidence_count > 1', () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const candidate = makeCandidateLesson({ evidence_count: 2, created_at: eightDaysAgo });
      expect(engine.shouldReject(candidate)).toBe(false);
    });
  });

  describe('shouldArchive', () => {
    it('should archive never-helpful memories', () => {
      const memory: Memory = { key: 'test', value: '', type: 'preference' };
      const stats: MemoryStats = {
        memory_key: 'test',
        times_observed: 1,
        times_retrieved: 11,
        times_helpful: 0,
        times_unhelpful: 0,
        last_confirmed_at: null,
        last_retrieved_at: new Date().toISOString(),
      };
      expect(engine.shouldArchive(memory, stats)).toBe(true);
    });

    it('should not archive helpful memories', () => {
      const memory: Memory = { key: 'test', value: '', type: 'preference' };
      const stats: MemoryStats = {
        memory_key: 'test',
        times_observed: 1,
        times_retrieved: 15,
        times_helpful: 3,
        times_unhelpful: 0,
        last_confirmed_at: null,
        last_retrieved_at: new Date().toISOString(),
      };
      expect(engine.shouldArchive(memory, stats)).toBe(false);
    });
  });

  describe('promote', () => {
    it('should create memory from candidate lesson', () => {
      const id = outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Always verify paths before file operations',
        lesson_kind: 'failure_preventer',
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.85,
        durability: 'project',
      });

      // Bump evidence to qualify
      outcomeStorage.incrementEvidenceCount(id);

      const memoryKey = engine.promote(id);
      expect(memoryKey).toBeDefined();
      expect(memoryKey).toContain('promoted_');

      // Verify candidate status updated
      const lesson = outcomeStorage.getCandidateLessonById(id);
      expect(lesson!.status).toBe('promoted');
      expect(lesson!.promoted_memory_key).toBe(memoryKey);

      // Verify memory was stored
      const memory = MemoryService.getInstance().retrieve(memoryKey);
      expect(memory).toBeDefined();
      expect(memory!.type).toBe('failure');
      expect(memory!.value.content).toBe('Always verify paths before file operations');
    });
  });

  describe('runCycle', () => {
    it('should promote eligible candidates and reject stale ones', () => {
      // Create a candidate with evidence_count >= 2 (promotable)
      const id1 = outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Lesson to promote',
        lesson_kind: 'rule',
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.8,
        durability: 'project',
      });
      outcomeStorage.incrementEvidenceCount(id1);

      // Create a stale candidate (rejectable)
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const db = MemoryService.getInstance().getDatabase();
      const id2 = 'stale-' + Date.now();
      db.prepare(`
        INSERT INTO candidate_lessons (id, project_id, lesson_text, lesson_kind,
          outcome_type, reward_band, confidence, durability, evidence_count, status, created_at, updated_at)
        VALUES (?, 'test-project', 'Stale lesson', 'rule', 'negative', -1, 0.7, 'project', 1, 'candidate', ?, ?)
      `).run(id2, eightDaysAgo, eightDaysAgo);

      const result = engine.runCycle('test-project');
      expect(result.promoted).toBe(1);
      expect(result.archived).toBeGreaterThanOrEqual(1);

      // Verify statuses
      expect(outcomeStorage.getCandidateLessonById(id1)!.status).toBe('promoted');
      expect(outcomeStorage.getCandidateLessonById(id2)!.status).toBe('rejected');
    });

    it('should return zeros when no candidates exist', () => {
      const result = engine.runCycle('empty-project');
      expect(result.promoted).toBe(0);
      expect(result.archived).toBe(0);
    });
  });

  describe('promoted lessons appear in loadActiveRules', () => {
    it('should include promoted lessons in rules output', () => {
      // Create and promote a failure_preventer lesson
      const id = outcomeStorage.createCandidateLesson({
        project_id: 'test-project',
        lesson_text: 'Never run rm -rf without confirmation',
        lesson_kind: 'failure_preventer',
        outcome_type: 'negative',
        reward_band: -1,
        confidence: 0.85,
        durability: 'project',
      });
      outcomeStorage.incrementEvidenceCount(id);
      engine.promote(id);

      // Load rules and check the promoted lesson appears
      const rules = MemoryService.getInstance().loadActiveRules('test-project');
      const allValues = [...rules.failures].map(m =>
        typeof m.value === 'object' ? JSON.stringify(m.value) : m.value
      );
      const found = allValues.some(v => v.includes('Never run rm -rf without confirmation'));
      expect(found).toBe(true);
    });
  });
});

// Helper to create a minimal CandidateLesson object
function makeCandidateLesson(overrides: Partial<CandidateLesson> = {}): CandidateLesson {
  return {
    id: 'test-id',
    project_id: 'test-project',
    episode_id: null,
    lesson_text: 'Test lesson',
    lesson_kind: 'failure_preventer',
    applies_when_json: null,
    outcome_type: 'negative',
    reward_band: -1,
    confidence: 0.8,
    durability: 'project',
    evidence_count: 1,
    status: 'candidate',
    promoted_memory_key: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}
