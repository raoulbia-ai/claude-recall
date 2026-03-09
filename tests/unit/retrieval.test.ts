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