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
      
      // Manually update last_accessed since it's set by retrieval
      const db = (storage as any).db;
      db.prepare('UPDATE memories SET last_accessed = ? WHERE key = ?').run(recentAccess, 'recent_access');
      db.prepare('UPDATE memories SET last_accessed = ? WHERE key = ?').run(oldAccess, 'old_access');
      
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