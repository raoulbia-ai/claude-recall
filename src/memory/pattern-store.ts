import { MemoryStorage } from './storage';
import { CorrectionPattern } from '../core/patterns';

export class PatternStore {
  constructor(private storage: MemoryStorage) {}
  
  savePattern(pattern: CorrectionPattern): void {
    const existing = this.findSimilar(pattern);
    
    if (existing) {
      existing.frequency++;
      this.storage.save({
        key: `pattern_${existing.id}`,
        value: existing,
        type: 'correction-pattern',
        project_id: process.env.CLAUDE_PROJECT_DIR,
        file_path: undefined,
        timestamp: Date.now(),
        relevance_score: existing.frequency / 10
      });
    } else {
      this.storage.save({
        key: `pattern_${Date.now()}`,
        value: pattern,
        type: 'correction-pattern',
        project_id: process.env.CLAUDE_PROJECT_DIR,
        file_path: undefined,
        timestamp: Date.now(),
        relevance_score: 0.1
      });
    }
  }
  
  private findSimilar(pattern: CorrectionPattern): any | null {
    // Search for similar patterns in memory
    const memories = this.storage.searchByContext({
      type: 'correction-pattern',
      project_id: process.env.CLAUDE_PROJECT_DIR,
      file_path: undefined
    });
    
    for (const memory of memories) {
      const stored = memory.value as any;
      if (stored.original === pattern.original && 
          stored.corrected === pattern.corrected &&
          stored.context === pattern.context) {
        return {
          ...stored,
          id: memory.key.replace('pattern_', '')
        };
      }
    }
    
    return null;
  }
  
  getFrequentPatterns(minFrequency: number = 2): CorrectionPattern[] {
    const patterns = this.storage.searchByContext({
      type: 'correction-pattern',
      project_id: process.env.CLAUDE_PROJECT_DIR,
      file_path: undefined
    });
    
    return patterns
      .map(m => m.value as CorrectionPattern)
      .filter(p => p.frequency >= minFrequency)
      .sort((a, b) => b.frequency - a.frequency);
  }
}