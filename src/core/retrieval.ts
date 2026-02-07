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

    const lowerQuery = query.toLowerCase();

    // Stop words — common English words that match too broadly in LIKE queries
    const stopWords = new Set([
      // Articles, pronouns, prepositions
      'the', 'a', 'an', 'this', 'that', 'these', 'those',
      'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its',
      'he', 'she', 'his', 'her', 'they', 'them', 'their',
      'in', 'on', 'at', 'to', 'of', 'by', 'up', 'as', 'if',
      'or', 'and', 'but', 'not', 'no', 'so', 'do', 'be',
      // Common verbs / conversational filler
      'is', 'are', 'was', 'were', 'am', 'been', 'being',
      'has', 'have', 'had', 'does', 'did', 'will', 'would',
      'can', 'could', 'shall', 'should', 'may', 'might', 'must',
      'get', 'got', 'set', 'let', 'put', 'say', 'said',
      'use', 'used', 'using', 'make', 'made', 'take', 'see',
      'yes', 'no', 'ok', 'okay', 'sure', 'just', 'also',
      'any', 'all', 'some', 'each', 'every', 'both', 'few',
      // Question words
      'what', 'which', 'how', 'when', 'where', 'who', 'why',
      // Common dev-conversation noise
      'want', 'need', 'know', 'think', 'try', 'like',
      'file', 'code', 'work', 'thing', 'way', 'one', 'new',
      'first', 'into', 'with', 'from', 'about', 'then', 'there',
      'here', 'only', 'very', 'much', 'more', 'most', 'well',
      'now', 'out', 'over', 'own', 'same', 'than', 'too',
      'create', 'run', 'add', 'change', 'check', 'look',
      'before', 'after', 'still', 'already', 'yet',
    ]);

    // Domain keywords — always include if present in the query
    const domainKeywords = [
      'database', 'postgres', 'postgresql', 'mysql', 'sqlite', 'mongodb', 'redis',
      'nosql', 'authentication', 'auth', 'jwt', 'oauth', 'docker', 'kubernetes',
      'typescript', 'javascript', 'python', 'react', 'webpack', 'eslint', 'prettier',
      'api', 'rest', 'graphql', 'grpc', 'websocket', 'migration', 'schema',
      'deploy', 'ci', 'pipeline', 'terraform', 'nginx',
    ];

    const matched = domainKeywords.filter(kw => lowerQuery.includes(kw));

    // Extract significant words: 4+ chars, not stop words, alphanumeric only
    const words = lowerQuery
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9-]/g, ''))
      .filter(w => w.length >= 4 && !stopWords.has(w));

    return [...new Set([...matched, ...words])];
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
        }
      }

      if (keywordMatches > 0) {
        // Scale boost by the fraction of keywords matched.
        // 1 of 5 keywords → modest boost; 5 of 5 → large boost.
        const matchRatio = keywordMatches / context.keywords.length;
        score *= 1 + matchRatio * 3.0;  // Up to 4x for full match

        // Extra boost if ALL keywords match
        if (keywordMatches === context.keywords.length) {
          score *= 1.5;
        }
      } else {
        // No keyword overlap — penalise so these rank below matching results
        score *= 0.3;
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