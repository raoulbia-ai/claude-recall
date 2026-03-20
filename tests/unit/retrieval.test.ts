import { MemoryRetrieval } from '../../src/core/retrieval';
import { MemoryStorage } from '../../src/memory/storage';

describe('MemoryRetrieval', () => {
  let storage: MemoryStorage;
  let retrieval: MemoryRetrieval;
  
  beforeEach(() => {
    storage = new MemoryStorage(':memory:');
    retrieval = new MemoryRetrieval(storage);
  });
  
  afterEach(() => {
    storage.close();
  });
  
  describe('findRelevant', () => {
    it('should return memories sorted by relevance score', () => {
      // Create test memories
      storage.save({
        key: 'memory1',
        value: { data: 'test1' },
        type: 'preference',
        project_id: 'project1',
        file_path: 'file1.ts',
        relevance_score: 0.5
      });
      
      storage.save({
        key: 'memory2',
        value: { data: 'test2' },
        type: 'preference',
        project_id: 'project1',
        file_path: 'file2.ts',
        relevance_score: 0.8
      });
      
      storage.save({
        key: 'memory3',
        value: { data: 'test3' },
        type: 'preference',
        project_id: 'project2',
        file_path: 'file3.ts',
        relevance_score: 0.9
      });
      
      const context = {
        project_id: 'project1',
        file_path: 'file1.ts'
      };
      
      const results = retrieval.findRelevant(context);
      
      expect(results.length).toBeLessThanOrEqual(5);
      expect(results.length).toBeGreaterThan(0);
      if (results.length > 1) {
        expect(results[0].key).toBe('memory1'); // Highest score due to file match
        expect(results[0].score).toBeGreaterThan(results[1].score);
      }
    });
    
    it('should apply forgetting curve decay', () => {
      const oldTimestamp = Date.now() - (10 * 24 * 60 * 60 * 1000); // 10 days ago
      const recentTimestamp = Date.now() - (1 * 24 * 60 * 60 * 1000); // 1 day ago
      
      storage.save({
        key: 'old_memory',
        value: { data: 'old' },
        type: 'preference',
        timestamp: oldTimestamp,
        relevance_score: 1.0
      });
      
      storage.save({
        key: 'recent_memory',
        value: { data: 'recent' },
        type: 'preference',
        timestamp: recentTimestamp,
        relevance_score: 1.0
      });
      
      const results = retrieval.findRelevant({});
      
      const oldMemory = results.find(m => m.key === 'old_memory');
      const recentMemory = results.find(m => m.key === 'recent_memory');
      
      expect(oldMemory).toBeDefined();
      expect(recentMemory).toBeDefined();
      expect(recentMemory!.score).toBeGreaterThan(oldMemory!.score);
    });
    
    it('should boost frequently accessed memories', () => {
      storage.save({
        key: 'popular',
        value: { data: 'popular' },
        type: 'preference',
        access_count: 10,
        relevance_score: 0.5
      });
      
      storage.save({
        key: 'unpopular',
        value: { data: 'unpopular' },
        type: 'preference',
        access_count: 0,
        relevance_score: 0.5
      });
      
      const results = retrieval.findRelevant({});
      
      const popular = results.find(m => m.key === 'popular');
      const unpopular = results.find(m => m.key === 'unpopular');
      
      expect(popular).toBeDefined();
      expect(unpopular).toBeDefined();
      expect(popular!.score).toBeGreaterThan(unpopular!.score);
    });
    
    it('should boost recently accessed memories', () => {
      const recentAccess = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
      const oldAccess = Date.now() - (48 * 60 * 60 * 1000); // 48 hours ago
      
      storage.save({
        key: 'recent_access',
        value: { data: 'recent' },
        type: 'preference',
        relevance_score: 0.5
      });
      
      storage.save({
        key: 'old_access',
        value: { data: 'old' },
        type: 'preference',
        relevance_score: 0.5
      });
      
      // Manually update last_accessed and access_count to simulate usage
      const db = (storage as any).db;
      db.prepare('UPDATE memories SET last_accessed = ?, access_count = 10 WHERE key = ?').run(recentAccess, 'recent_access');
      db.prepare('UPDATE memories SET last_accessed = ?, access_count = 1 WHERE key = ?').run(oldAccess, 'old_access');
      
      const results = retrieval.findRelevant({});
      
      const recent = results.find(m => m.key === 'recent_access');
      const old = results.find(m => m.key === 'old_access');
      
      expect(recent).toBeDefined();
      expect(old).toBeDefined();
      expect(recent!.score).toBeGreaterThan(old!.score);
    });
    
    it('should limit results to top 5', () => {
      // Create 10 memories
      for (let i = 0; i < 10; i++) {
        storage.save({
          key: `memory${i}`,
          value: { data: `test${i}` },
          type: 'preference',
          relevance_score: Math.random()
        });
      }
      
      const results = retrieval.findRelevant({});
      expect(results.length).toBe(5);
    });
  });
  
  describe('classifyMemory', () => {
    it('classifies devops and tool-use as procedural', () => {
      expect(MemoryRetrieval.classifyMemory('devops')).toBe('procedural');
      expect(MemoryRetrieval.classifyMemory('tool-use')).toBe('procedural');
    });

    it('classifies preference, project-knowledge, correction as factual', () => {
      expect(MemoryRetrieval.classifyMemory('preference')).toBe('factual');
      expect(MemoryRetrieval.classifyMemory('project-knowledge')).toBe('factual');
      expect(MemoryRetrieval.classifyMemory('correction')).toBe('factual');
    });

    it('classifies failure, conversation, unknown as episodic', () => {
      expect(MemoryRetrieval.classifyMemory('failure')).toBe('episodic');
      expect(MemoryRetrieval.classifyMemory('conversation')).toBe('episodic');
      expect(MemoryRetrieval.classifyMemory('something-unknown')).toBe('episodic');
    });
  });

  describe('computeStrength', () => {
    it('returns low strength for brand-new episodic memory', () => {
      const strength = MemoryRetrieval.computeStrength({
        key: 'new',
        value: 'test',
        type: 'failure',
        timestamp: Date.now(),
        access_count: 0,
        cite_count: 0,
        load_count: 0,
      });
      // Episodic base 0.10
      expect(strength).toBeGreaterThan(0.05);
      expect(strength).toBeLessThan(0.15);
    });

    it('procedural memories start stronger than episodic', () => {
      const base = { key: 'x', value: 'test', timestamp: Date.now(), access_count: 0, cite_count: 0, load_count: 0 };
      const procedural = MemoryRetrieval.computeStrength({ ...base, type: 'devops' });
      const factual = MemoryRetrieval.computeStrength({ ...base, type: 'preference' });
      const episodic = MemoryRetrieval.computeStrength({ ...base, type: 'failure' });

      expect(procedural).toBeGreaterThan(factual);
      expect(factual).toBeGreaterThan(episodic);
    });

    it('returns high strength for heavily used memory', () => {
      const strength = MemoryRetrieval.computeStrength({
        key: 'strong',
        value: 'test',
        type: 'preference',
        timestamp: Date.now(),
        last_accessed: Date.now(),
        access_count: 50,
        cite_count: 20,
        load_count: 30,
      });
      expect(strength).toBeGreaterThanOrEqual(0.9);
    });

    it('decays over time when not accessed', () => {
      const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
      const strength = MemoryRetrieval.computeStrength({
        key: 'old',
        value: 'test',
        type: 'preference',
        timestamp: sixtyDaysAgo,
        access_count: 5,
        cite_count: 2,
        load_count: 3,
      });
      const freshStrength = MemoryRetrieval.computeStrength({
        key: 'fresh',
        value: 'test',
        type: 'preference',
        timestamp: Date.now(),
        access_count: 5,
        cite_count: 2,
        load_count: 3,
      });
      // 60 days = 1 half-life for factual (preference), so ~50% decay
      expect(strength).toBeLessThan(freshStrength * 0.6);
    });

    it('caps at 1.0 even with extreme counts', () => {
      const strength = MemoryRetrieval.computeStrength({
        key: 'extreme',
        value: 'test',
        type: 'preference',
        timestamp: Date.now(),
        last_accessed: Date.now(),
        access_count: 1000,
        cite_count: 1000,
        load_count: 1000,
      });
      expect(strength).toBeLessThanOrEqual(1.0);
    });

    it('procedural memories decay slower than episodic', () => {
      const sixtyDaysAgo = Date.now() - 60 * 24 * 60 * 60 * 1000;
      const base = { key: 'x', value: 'test', timestamp: sixtyDaysAgo, access_count: 10, cite_count: 5, load_count: 10 };
      const procedural = MemoryRetrieval.computeStrength({ ...base, type: 'devops' });
      const episodic = MemoryRetrieval.computeStrength({ ...base, type: 'failure' });
      // Procedural: 90-day half-life vs episodic: 30-day half-life
      expect(procedural).toBeGreaterThan(episodic * 1.5);
    });
  });

  describe('outcome-aware scoring', () => {
    it('should boost score for memories with evidence count > 1', () => {
      storage.save({
        key: 'promoted_mem',
        value: { data: 'promoted lesson' },
        type: 'preference',
        relevance_score: 1.0,
      });

      storage.save({
        key: 'normal_mem',
        value: { data: 'normal lesson' },
        type: 'preference',
        relevance_score: 1.0,
      });

      // Create outcome tables and a promoted candidate lesson linked to promoted_mem
      const db = storage.getDatabase();
      db.exec(`
        INSERT OR IGNORE INTO candidate_lessons (id, project_id, lesson_text, lesson_kind,
          outcome_type, reward_band, confidence, durability, evidence_count, status,
          promoted_memory_key, created_at, updated_at)
        VALUES ('cl1', 'test', 'test', 'rule', 'negative', -1, 0.8, 'project', 3, 'promoted',
          'promoted_mem', datetime('now'), datetime('now'))
      `);

      const results = retrieval.findRelevant({});
      const promoted = results.find(m => m.key === 'promoted_mem');
      const normal = results.find(m => m.key === 'normal_mem');

      expect(promoted).toBeDefined();
      expect(normal).toBeDefined();
      expect(promoted!.score).toBeGreaterThan(normal!.score);
    });

    it('should apply helpfulness prior from memory_stats', () => {
      storage.save({
        key: 'helpful_mem',
        value: { data: 'helpful' },
        type: 'preference',
        relevance_score: 1.0,
      });

      storage.save({
        key: 'unhelpful_mem',
        value: { data: 'unhelpful' },
        type: 'preference',
        relevance_score: 1.0,
      });

      const db = storage.getDatabase();
      db.exec(`
        INSERT INTO memory_stats (memory_key, times_retrieved, times_helpful)
        VALUES ('helpful_mem', 10, 8)
      `);
      db.exec(`
        INSERT INTO memory_stats (memory_key, times_retrieved, times_helpful)
        VALUES ('unhelpful_mem', 10, 0)
      `);

      const results = retrieval.findRelevant({});
      const helpful = results.find(m => m.key === 'helpful_mem');
      const unhelpful = results.find(m => m.key === 'unhelpful_mem');

      expect(helpful).toBeDefined();
      expect(unhelpful).toBeDefined();
      expect(helpful!.score).toBeGreaterThan(unhelpful!.score);
    });

    it('should apply staleness penalty for old unconfirmed memories', () => {
      storage.save({
        key: 'fresh_confirmed',
        value: { data: 'fresh' },
        type: 'preference',
        relevance_score: 1.0,
      });

      storage.save({
        key: 'stale_confirmed',
        value: { data: 'stale' },
        type: 'preference',
        relevance_score: 1.0,
      });

      const db = storage.getDatabase();
      const recentDate = new Date().toISOString();
      const oldDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();

      db.exec(`
        INSERT INTO memory_stats (memory_key, times_retrieved, times_helpful, last_confirmed_at)
        VALUES ('fresh_confirmed', 5, 3, '${recentDate}')
      `);
      db.exec(`
        INSERT INTO memory_stats (memory_key, times_retrieved, times_helpful, last_confirmed_at)
        VALUES ('stale_confirmed', 5, 3, '${oldDate}')
      `);

      const results = retrieval.findRelevant({});
      const fresh = results.find(m => m.key === 'fresh_confirmed');
      const stale = results.find(m => m.key === 'stale_confirmed');

      expect(fresh).toBeDefined();
      expect(stale).toBeDefined();
      expect(fresh!.score).toBeGreaterThan(stale!.score);
    });
  });

  describe('searchByKeyword', () => {
    it('should search memories by keyword and apply relevance scoring', () => {
      storage.save({
        key: 'auth_function',
        value: { name: 'authenticateUser', description: 'User authentication' },
        type: 'function',
        relevance_score: 0.8
      });
      
      storage.save({
        key: 'auth_pattern',
        value: { pattern: 'authentication flow' },
        type: 'pattern',
        relevance_score: 0.6
      });
      
      storage.save({
        key: 'unrelated',
        value: { data: 'something else' },
        type: 'other',
        relevance_score: 0.9
      });
      
      const results = retrieval.searchByKeyword('auth');
      
      expect(results.length).toBe(2);
      expect(results[0].key).toContain('auth');
      expect(results[1].key).toContain('auth');
      
      // Should be sorted by score
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    });
  });
});