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
    } catch { /* best-effort cleanup — ignore */ }
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
