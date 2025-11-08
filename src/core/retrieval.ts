import { MemoryStorage, Memory } from '../memory/storage';

export interface Context {
  project_id?: string;
  file_path?: string;
  tool?: string;
  type?: string;
  timestamp?: number;
  query?: string;  // User's actual query content
  keywords?: string[];  // Extracted keywords from query
}

export interface ScoredMemory extends Memory {
  score: number;
}

export class MemoryRetrieval {
  constructor(private storage: MemoryStorage) {}
  
  // Extract keywords from user query for better semantic search
  private extractKeywords(query: string): string[] {
    if (!query) return [];
    
    // Common database-related keywords
    const dbKeywords = ['database', 'db', 'postgres', 'postgresql', 'mysql', 'sqlite', 
                        'mongodb', 'redis', 'sql', 'nosql', 'storage'];
    
    // Convert query to lowercase for matching
    const lowerQuery = query.toLowerCase();
    
    // Extract matching database keywords
    const keywords = dbKeywords.filter(keyword => lowerQuery.includes(keyword));
    
    // Also extract significant words (3+ chars, not common words)
    const commonWords = ['the', 'what', 'which', 'how', 'when', 'where', 'are', 'is', 
                         'do', 'we', 'use', 'using', 'for', 'and', 'or', 'in', 'to'];
    
    const words = lowerQuery.split(/\s+/)
      .filter(word => word.length >= 3 && !commonWords.includes(word));
    
    // Combine keywords and significant words
    return [...new Set([...keywords, ...words])];
  }
  
  findRelevant(context: Context, sortBy: 'relevance' | 'timestamp' = 'relevance'): ScoredMemory[] {
    // Extract keywords from query if provided
    if (context.query && !context.keywords) {
      context.keywords = this.extractKeywords(context.query);
    }

    // Use enhanced search that looks for keywords in memory values
    const candidates = this.storage.searchByContext(context);

    if (sortBy === 'timestamp') {
      // Sort by timestamp DESC (newest first)
      const sorted = candidates
        .map(memory => ({
          ...memory,
          score: 1.0 // Placeholder score for timestamp sorting
        }))
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

      // Return top results (no limit applied here, caller controls via slice)
      return sorted;
    }

    // Default: relevance sorting
    // Score and prioritize by memory type
    const scored = candidates
      .map(memory => ({
        ...memory,
        score: this.calculateRelevance(memory, context)
      }))
      .sort((a, b) => {
        // First priority: memory type (project-knowledge > preference > tool-use)
        const typeOrder: Record<string, number> = { 'project-knowledge': 3, 'preference': 2, 'tool-use': 1 };
        const aTypeScore = typeOrder[a.type] || 0;
        const bTypeScore = typeOrder[b.type] || 0;

        if (aTypeScore !== bTypeScore) {
          return bTypeScore - aTypeScore;
        }

        // Second priority: relevance score
        return b.score - a.score;
      });

    // Return top 5 most relevant memories
    return scored.slice(0, 5);
  }
  
  private calculateRelevance(memory: Memory, context: Context): number {
    let score = memory.relevance_score || 1.0;
    
    // Boost for keyword matches in memory value
    if (context.keywords && context.keywords.length > 0) {
      const memoryStr = JSON.stringify(memory.value).toLowerCase();
      let keywordMatches = 0;
      
      for (const keyword of context.keywords) {
        if (memoryStr.includes(keyword.toLowerCase())) {
          keywordMatches++;
          score *= 2.0;  // Double score for each keyword match
        }
      }
      
      // Extra boost if all keywords match
      if (keywordMatches === context.keywords.length) {
        score *= 1.5;
      }
    }
    
    // Decay over time (forgetting curve) - less aggressive for project-knowledge
    const timestamp = memory.timestamp || Date.now();
    const daysSince = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
    const decayFactor = memory.type === 'project-knowledge' ? 0.9 : 0.5;
    const halfLife = memory.type === 'project-knowledge' ? 30 : 7;
    score *= Math.pow(decayFactor, daysSince / halfLife);
    
    // Boost for same project/file
    if (memory.project_id && context.project_id && memory.project_id === context.project_id) {
      score *= 1.5;
    }
    if (memory.file_path && context.file_path && memory.file_path === context.file_path) {
      score *= 2.0;
    }
    
    // Boost for frequently accessed memories
    if (memory.access_count && memory.access_count > 0) {
      score *= 1 + Math.log10(memory.access_count) * 0.1;
    }
    
    // Boost for recent access
    if (memory.last_accessed) {
      const hoursSinceAccess = (Date.now() - memory.last_accessed) / (1000 * 60 * 60);
      if (hoursSinceAccess < 24) {
        score *= 1.2;
      }
    }
    
    return score;
  }
  
  searchByKeyword(keyword: string): ScoredMemory[] {
    const results = this.storage.search(keyword);
    const context: Context = { timestamp: Date.now() };
    
    return results
      .map(memory => ({
        ...memory,
        score: this.calculateRelevance(memory, context)
      }))
      .sort((a, b) => b.score - a.score);
  }
}