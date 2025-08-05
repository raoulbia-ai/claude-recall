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
  
  describe('Core Search Enhancement', () => {
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
    });
    
    it('should enhance search based on detected task patterns', async () => {
      // Test create_test enhancement
      const testDirMemory: ScoredMemory = {
        key: 'pref_test_dir',
        value: { pattern: 'test directory', value: 'tests/' },
        type: 'preference',
        score: 0.8
      };
      
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query === 'test directory') return [testDirMemory];
        return [];
      });
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'create_test' });
      
      const result = await memoryEnhancer.enhanceSearch('create a test for the user service');
      
      expect(result).toContainEqual(expect.objectContaining({
        key: 'pref_test_dir',
        type: 'preference'
      }));
      
      // Test fix_bug enhancement
      const errorMemory: ScoredMemory = {
        key: 'error_1',
        value: { error: 'TypeError', fix: 'check null' },
        type: 'project-knowledge',
        score: 0.9
      };
      
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query === 'TypeError') return [errorMemory];
        return [];
      });
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'fix_bug' });
      
      const bugResult = await memoryEnhancer.enhanceSearch('fix TypeError in auth.js');
      
      expect(bugResult).toContainEqual(expect.objectContaining({
        key: 'error_1',
        type: 'project-knowledge'
      }));
    });
    
    it('should deduplicate and rank memories correctly', async () => {
      const prompt = 'test query';
      const memory1 = { key: 'dup_1', value: 'duplicate', type: 'project-knowledge', score: 0.8 };
      const memory2 = { key: 'dup_1', value: 'duplicate', type: 'project-knowledge', score: 0.7 };
      
      mockMemoryService.search.mockReturnValue([memory1]);
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'create_test' });
      
      // Mock the task-specific search to return the duplicate with lower score
      mockMemoryService.search.mockImplementation((query: string) => {
        if (query === prompt) return [memory1];
        return [memory2]; // Additional searches return duplicate with lower score
      });
      
      const result = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should only have one instance, keeping the direct match
      const dupMemories = result.filter(m => m.key === 'dup_1');
      expect(dupMemories).toHaveLength(1);
      expect(dupMemories[0].score).toBe(0.8); // Direct match score is preserved
    });
    
    it('should handle empty results gracefully', async () => {
      mockMemoryService.search.mockReturnValue([]);
      mockMemoryService.findRelevant.mockReturnValue([]);
      mockPatternService.analyzePrompt.mockReturnValue({ taskType: 'create_test' });
      
      const result = await memoryEnhancer.enhanceSearch('any prompt');
      
      expect(result).toEqual([]);
      expect(() => memoryEnhancer.enhanceSearch('any prompt')).not.toThrow();
    });
  });
  
});