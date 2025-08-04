import { MemoryEnhancer } from '../../src/services/memory-enhancer';
import { MemoryService } from '../../src/services/memory';
import { PatternService } from '../../src/services/pattern-service';
import { ScoredMemory } from '../../src/core/retrieval';

// Mock dependencies
jest.mock('../../src/services/memory');
jest.mock('../../src/services/pattern-service');

describe('MemoryEnhancer', () => {
  let memoryEnhancer: MemoryEnhancer;
  let mockMemoryService: jest.Mocked<MemoryService>;
  let mockPatternService: jest.Mocked<PatternService>;
  
  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Setup mocks
    mockMemoryService = {
      search: jest.fn(),
      findRelevant: jest.fn(),
    } as any;
    
    mockPatternService = {
      analyzePrompt: jest.fn(),
    } as any;
    
    // Mock getInstance methods
    (MemoryService.getInstance as jest.Mock).mockReturnValue(mockMemoryService);
    (PatternService.getInstance as jest.Mock).mockReturnValue(mockPatternService);
    
    // Create instance
    memoryEnhancer = new MemoryEnhancer();
  });
  
  describe('enhanceSearch', () => {
    it('should return direct matches when no patterns detected', async () => {
      const prompt = 'find user authentication code';
      const directMatches: ScoredMemory[] = [
        { key: 'auth_1', value: 'auth code', type: 'project-knowledge', score: 0.9 }
      ];
      
      mockMemoryService.search.mockReturnValue(directMatches);
      mockPatternService.analyzePrompt.mockReturnValue({});
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toEqual(directMatches);
      expect(mockMemoryService.search).toHaveBeenCalledWith(prompt);
      expect(mockPatternService.analyzePrompt).toHaveBeenCalledWith(prompt);
    });
    
    it('should include test preferences for create_test prompts', async () => {
      const prompt = 'create a test for the user service';
      const directMatches: ScoredMemory[] = [];
      const testDirMemory: ScoredMemory = {
        key: 'pref_test_dir',
        value: { pattern: 'test directory', value: 'tests-raoul/' },
        type: 'preference',
        score: 0.8
      };
      
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query === prompt) return directMatches;
        if (query === 'test directory') return [testDirMemory];
        return [];
      });
      
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'create_test' });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'pref_test_dir',
        type: 'preference'
      }));
      expect(mockMemoryService.search).toHaveBeenCalledWith('test directory');
    });
    
    it('should include error history for fix_bug prompts', async () => {
      const prompt = 'fix TypeError in auth.js';
      const directMatches: ScoredMemory[] = [];
      const errorMemory: ScoredMemory = {
        key: 'error_history_1',
        value: { error: 'TypeError', fix: 'check null values' },
        type: 'project-knowledge',
        score: 0.9
      };
      
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query === prompt) return directMatches;
        if (query === 'TypeError') return [errorMemory];
        return [];
      });
      
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ 
        taskType: 'fix_bug',
        entities: ['auth.js']
      });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'error_history_1',
        type: 'project-knowledge'
      }));
      expect(mockMemoryService.search).toHaveBeenCalledWith('TypeError');
    });
    
    it('should include code conventions for refactor prompts', async () => {
      const prompt = 'refactor this function to use modern syntax';
      const directMatches: ScoredMemory[] = [];
      const styleMemory: ScoredMemory = {
        key: 'style_pref_1',
        value: { preference: 'use arrow functions' },
        type: 'preference',
        score: 0.7
      };
      
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query === prompt) return directMatches;
        return [];
      });
      
      mockMemoryService.findRelevant.mockImplementation((context: any) => {
        if (context.keywords?.includes('style')) return [styleMemory];
        return [];
      });
      
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'refactor' });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'style_pref_1',
        type: 'preference'
      }));
    });
    
    it('should deduplicate memories from multiple sources', async () => {
      const prompt = 'create a test for auth';
      const memory: ScoredMemory = {
        key: 'test_pref_1',
        value: 'test preference',
        type: 'preference',
        score: 0.8
      };
      
      // Return same memory from multiple searches
      mockMemoryService.search.mockReturnValue([memory]);
      mockMemoryService.findRelevant.mockReturnValue([memory]);
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'create_test' });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should only have one instance of the memory
      const count = result.filter(m => m.key === 'test_pref_1').length;
      expect(count).toBe(1);
    });
    
    it('should maintain relevance ranking', async () => {
      const prompt = 'add user endpoint';
      const memories: ScoredMemory[] = [
        { key: 'm1', value: 'v1', type: 'tool-use', score: 0.5 },
        { key: 'm2', value: 'v2', type: 'preference', score: 0.7 },
        { key: 'm3', value: 'v3', type: 'project-knowledge', score: 0.6 }
      ];
      
      mockMemoryService.search.mockReturnValue(memories);
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'add_feature' });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should be sorted by type priority first, then score
      expect(result[0].type).toBe('project-knowledge');
      expect(result[1].type).toBe('preference');
      expect(result[2].type).toBe('tool-use');
    });
    
    it('should handle empty results gracefully', async () => {
      const prompt = 'do something';
      
      mockMemoryService.search.mockReturnValue([]);
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({});
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toEqual([]);
      expect(result).toBeInstanceOf(Array);
    });
  });
  
  describe('task-specific retrieval', () => {
    it('should find test directory preferences for test creation', async () => {
      const prompt = 'create a test for authentication';
      const testDirPref: ScoredMemory = {
        key: 'test_dir_pref',
        value: { directory: 'tests-raoul/' },
        type: 'preference',
        score: 0.9
      };
      
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query.includes('test') && query.includes('directory')) {
          return [testDirPref];
        }
        return [];
      });
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'create_test' });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'test_dir_pref'
      }));
    });
    
    it('should find similar errors for bug fixes', async () => {
      const prompt = 'fix undefined error in user.js';
      const errorHistory: ScoredMemory = {
        key: 'error_fix_1',
        value: { error: 'undefined', solution: 'add null check' },
        type: 'project-knowledge',
        score: 0.8
      };
      
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query === 'undefined') return [errorHistory];
        return [];
      });
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ 
        taskType: 'fix_bug',
        entities: ['user.js']
      });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'error_fix_1'
      }));
    });
    
    it('should find coding standards for refactoring', async () => {
      const prompt = 'refactor to use async/await';
      const codingStandard: ScoredMemory = {
        key: 'coding_standard_1',
        value: { standard: 'prefer async/await over promises' },
        type: 'preference',
        score: 0.85
      };
      
      mockMemoryService.search.mockReturnValue([]);
      mockMemoryService.findRelevant.mockImplementation((context: any) => {
        if (context.keywords?.includes('style')) return [codingStandard];
        return [];
      });
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'refactor' });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'coding_standard_1'
      }));
    });
    
    it('should find architectural patterns for features', async () => {
      const prompt = 'add new API endpoint for products';
      const apiPattern: ScoredMemory = {
        key: 'api_pattern_1',
        value: { pattern: 'RESTful endpoints under /api/v1' },
        type: 'project-knowledge',
        score: 0.9
      };
      
      mockMemoryService.search.mockReturnValue([]);
      mockMemoryService.findRelevant.mockImplementation((context: any) => {
        if (context.keywords?.includes('api')) return [apiPattern];
        return [];
      });
      mockPatternService.analyzePrompt.mockReturnValue({ 
        taskType: 'add_feature',
        entities: ['products']
      });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'api_pattern_1'
      }));
    });
  });
  
  describe('performance', () => {
    it('should complete search in under 100ms', async () => {
      const prompt = 'create a test for user service';
      const memories: ScoredMemory[] = Array(50).fill(null).map((_, i) => ({
        key: `mem_${i}`,
        value: `value_${i}`,
        type: 'project-knowledge',
        score: Math.random()
      }));
      
      mockMemoryService.search.mockReturnValue(memories.slice(0, 10));
      mockMemoryService.findRelevant.mockReturnValue(memories.slice(10, 20));
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'create_test' });
      
      const startTime = Date.now();
      await memoryEnhancer.enhanceSearch(prompt);
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(100);
    });
    
    it('should not block on pattern detection', async () => {
      const prompt = 'refactor authentication module';
      
      // Simulate slow pattern detection
      mockPatternService.analyzePrompt.mockImplementation(() => {
        // Pattern detection should be synchronous and fast
        return { taskType: 'refactor' };
      });
      
      mockMemoryService.search.mockReturnValue([]);
      mockMemoryService.findRelevant.mockReturnValue([]);
      
      const startTime = Date.now();
      await memoryEnhancer.enhanceSearch(prompt);
      const endTime = Date.now();
      
      // Even with pattern detection, should be fast
      expect(endTime - startTime).toBeLessThan(50);
    });
  });
});