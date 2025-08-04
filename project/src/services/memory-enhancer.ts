import { MemoryService } from './memory';
import { PatternService } from './pattern-service';
import { Memory } from '../memory/storage';
import { ScoredMemory } from '../core/retrieval';
import { DetectedPattern } from '../core/pattern-detector';

export class MemoryEnhancer {
  private memoryService: MemoryService;
  private patternService: PatternService;
  
  constructor() {
    this.memoryService = MemoryService.getInstance();
    this.patternService = PatternService.getInstance();
  }
  
  async enhanceSearch(prompt: string): Promise<ScoredMemory[]> {
    // 1. Use existing search first (preserve current functionality)
    const directMatches = this.memoryService.search(prompt);
    
    // 2. Detect patterns in the prompt
    const patterns = this.patternService.analyzePrompt(prompt);
    
    // 3. Add task-specific memory searches
    const additionalMemories = this.getTaskSpecificMemories(patterns, prompt);
    
    // 4. Merge and deduplicate results
    return this.mergeAndRankMemories(directMatches, additionalMemories);
  }
  
  private getTaskSpecificMemories(patterns: DetectedPattern, prompt: string): ScoredMemory[] {
    const memories: ScoredMemory[] = [];
    const lowerPrompt = prompt.toLowerCase();
    
    if (patterns.taskType === 'create_test') {
      // Search for memories containing test directory preferences
      const testDirMemories = this.memoryService.search('test directory');
      memories.push(...testDirMemories);
      
      const testFolderMemories = this.memoryService.search('tests location');
      memories.push(...testFolderMemories);
      
      const testsPrefMemories = this.memoryService.search('tests folder');
      memories.push(...testsPrefMemories);
      
      // Search for memories with type "preference" related to testing
      const testPreferences = this.memoryService.findRelevant({
        type: 'preference',
        keywords: ['test', 'tests', 'testing', 'spec', 'unit']
      });
      memories.push(...testPreferences);
      
      // Search for previous test file creations in the project
      const testFileMemories = this.memoryService.findRelevant({
        keywords: ['test', 'spec', 'test.ts', 'test.js', '.test.', '.spec.']
      });
      memories.push(...testFileMemories);
    }
    
    else if (patterns.taskType === 'fix_bug') {
      // Extract error type if mentioned
      const errorTypes = ['TypeError', 'ReferenceError', 'SyntaxError', 'Error', 'undefined', 'null'];
      const mentionedErrors = errorTypes.filter(err => lowerPrompt.includes(err.toLowerCase()));
      
      // Search for similar error messages or types
      mentionedErrors.forEach(errorType => {
        const errorMemories = this.memoryService.search(errorType);
        memories.push(...errorMemories);
      });
      
      // Search for previous fixes in the same file
      if (patterns.entities) {
        const fileEntities = patterns.entities.filter(e => e.includes('.'));
        fileEntities.forEach(file => {
          const fileFixMemories = this.memoryService.findRelevant({
            filePath: file,
            keywords: ['fix', 'fixed', 'error', 'bug', 'issue']
          });
          memories.push(...fileFixMemories);
        });
      }
      
      // Search for correction patterns related to the error
      const correctionMemories = this.memoryService.findRelevant({
        type: 'preference',
        keywords: ['correction', 'fix', 'error', 'bug']
      });
      memories.push(...correctionMemories);
    }
    
    else if (patterns.taskType === 'refactor') {
      // Search for code style preferences
      const styleMemories = this.memoryService.findRelevant({
        type: 'preference',
        keywords: ['style', 'format', 'convention', 'pattern']
      });
      memories.push(...styleMemories);
      
      // Search for architectural patterns in the project
      const architectureMemories = this.memoryService.findRelevant({
        type: 'project-knowledge',
        keywords: ['architecture', 'pattern', 'structure', 'design']
      });
      memories.push(...architectureMemories);
      
      // Search for previous refactoring decisions
      const refactorMemories = this.memoryService.search('refactor');
      memories.push(...refactorMemories);
    }
    
    else if (patterns.taskType === 'add_feature') {
      // Search for project conventions and patterns
      const conventionMemories = this.memoryService.findRelevant({
        type: 'project-knowledge',
        keywords: ['convention', 'pattern', 'standard', 'guideline']
      });
      memories.push(...conventionMemories);
      
      // Search for similar feature implementations
      if (patterns.entities) {
        patterns.entities.forEach(entity => {
          const featureMemories = this.memoryService.search(entity);
          memories.push(...featureMemories);
        });
      }
      
      // Search for architecture decisions
      const architectureMemories = this.memoryService.findRelevant({
        type: 'project-knowledge',
        keywords: ['architecture', 'design', 'implementation', 'api', 'endpoint']
      });
      memories.push(...architectureMemories);
    }
    
    return memories;
  }
  
  private mergeAndRankMemories(direct: ScoredMemory[], additional: ScoredMemory[]): ScoredMemory[] {
    // Create a map to deduplicate by key
    const memoryMap = new Map<string, ScoredMemory>();
    
    // Add direct matches first (they have higher priority)
    direct.forEach(memory => {
      memoryMap.set(memory.key, memory);
    });
    
    // Add additional memories, but don't overwrite existing ones
    additional.forEach(memory => {
      if (!memoryMap.has(memory.key)) {
        // Slightly reduce score for indirect matches
        memory.score = memory.score * 0.8;
        memoryMap.set(memory.key, memory);
      }
    });
    
    // Convert back to array and sort by score
    const mergedMemories = Array.from(memoryMap.values());
    
    // Sort by score (descending) and type priority
    mergedMemories.sort((a, b) => {
      // First priority: memory type
      const typeOrder: Record<string, number> = { 
        'project-knowledge': 3, 
        'preference': 2, 
        'tool-use': 1 
      };
      const aTypeScore = typeOrder[a.type] || 0;
      const bTypeScore = typeOrder[b.type] || 0;
      
      if (aTypeScore !== bTypeScore) {
        return bTypeScore - aTypeScore;
      }
      
      // Second priority: relevance score
      return b.score - a.score;
    });
    
    // Return top 10 results to avoid overwhelming the context
    return mergedMemories.slice(0, 10);
  }
}