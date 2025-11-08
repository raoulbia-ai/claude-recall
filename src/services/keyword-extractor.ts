/**
 * Keyword Extractor Service
 * Phase 3B: Extract keywords from tool inputs for proactive memory search
 *
 * This service:
 * 1. Extracts meaningful keywords from tool call arguments
 * 2. Filters out stop words and noise
 * 3. Identifies technical terms and domain-specific keywords
 * 4. Provides ranked keywords for memory search
 */

import { LoggingService } from './logging';

export interface ExtractedKeywords {
  keywords: string[];
  technicalTerms: string[];
  allTokens: string[];
}

export class KeywordExtractor {
  private static instance: KeywordExtractor;
  private logger: LoggingService;

  // Common stop words to filter out
  private readonly STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
    'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this',
    'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they',
    'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each',
    'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
    'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just'
  ]);

  // Technical/programming keywords that are always relevant
  private readonly TECHNICAL_KEYWORDS = new Set([
    // Languages
    'javascript', 'typescript', 'python', 'java', 'go', 'rust', 'ruby', 'php',
    'c', 'cpp', 'csharp', 'swift', 'kotlin', 'scala',
    // Frameworks
    'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'express', 'fastify',
    'django', 'flask', 'rails', 'spring', 'laravel',
    // Testing
    'test', 'tests', 'testing', 'jest', 'mocha', 'chai', 'vitest', 'cypress',
    'playwright', 'selenium', 'spec', 'specs',
    // Tools
    'git', 'github', 'gitlab', 'docker', 'kubernetes', 'npm', 'yarn', 'pnpm',
    'webpack', 'vite', 'rollup', 'babel', 'eslint', 'prettier',
    // Databases
    'database', 'db', 'sql', 'mysql', 'postgresql', 'postgres', 'sqlite',
    'mongodb', 'redis', 'dynamodb',
    // Concepts
    'api', 'rest', 'graphql', 'http', 'https', 'endpoint', 'route', 'middleware',
    'component', 'function', 'class', 'module', 'package', 'library',
    'commit', 'branch', 'merge', 'pull', 'push', 'clone', 'fork'
  ]);

  private constructor() {
    this.logger = LoggingService.getInstance();
  }

  static getInstance(): KeywordExtractor {
    if (!KeywordExtractor.instance) {
      KeywordExtractor.instance = new KeywordExtractor();
    }
    return KeywordExtractor.instance;
  }

  /**
   * Extract keywords from tool call arguments
   * Returns ranked keywords suitable for memory search
   */
  extract(toolArgs: any): ExtractedKeywords {
    try {
      // Extract all text from arguments
      const text = this.extractText(toolArgs);

      // Tokenize
      const tokens = this.tokenize(text);

      // Filter and categorize
      const keywords = this.filterKeywords(tokens);
      const technicalTerms = this.identifyTechnicalTerms(tokens);

      // Combine and deduplicate
      const allKeywords = [...new Set([...technicalTerms, ...keywords])];

      this.logger.debug('KeywordExtractor', 'Extracted keywords', {
        totalTokens: tokens.length,
        keywords: allKeywords.length,
        technicalTerms: technicalTerms.length
      });

      return {
        keywords: allKeywords,
        technicalTerms,
        allTokens: tokens
      };

    } catch (error) {
      this.logger.error('KeywordExtractor', 'Failed to extract keywords', error);
      return {
        keywords: [],
        technicalTerms: [],
        allTokens: []
      };
    }
  }

  /**
   * Extract all text from various argument formats
   */
  private extractText(args: any): string {
    if (typeof args === 'string') {
      return args;
    }

    if (typeof args === 'object' && args !== null) {
      const textParts: string[] = [];

      // Extract from common fields
      if (args.content) textParts.push(this.extractText(args.content));
      if (args.text) textParts.push(this.extractText(args.text));
      if (args.message) textParts.push(this.extractText(args.message));
      if (args.query) textParts.push(this.extractText(args.query));
      if (args.description) textParts.push(this.extractText(args.description));
      if (args.name) textParts.push(this.extractText(args.name));
      if (args.key) textParts.push(this.extractText(args.key));
      if (args.value) textParts.push(this.extractText(args.value));

      // Extract from all string values recursively
      for (const value of Object.values(args)) {
        if (typeof value === 'string') {
          textParts.push(value);
        } else if (typeof value === 'object' && value !== null) {
          textParts.push(this.extractText(value));
        }
      }

      return textParts.join(' ');
    }

    return '';
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ') // Keep hyphens for compound words
      .split(/\s+/)
      .filter(token => token.length > 0);
  }

  /**
   * Filter tokens to extract meaningful keywords
   */
  private filterKeywords(tokens: string[]): string[] {
    return tokens
      .filter(token => {
        // Remove stop words
        if (this.STOP_WORDS.has(token)) return false;

        // Keep tokens that are at least 3 characters
        if (token.length < 3) return false;

        // Keep tokens that aren't just numbers
        if (/^\d+$/.test(token)) return false;

        return true;
      });
  }

  /**
   * Identify technical/programming terms
   */
  private identifyTechnicalTerms(tokens: string[]): string[] {
    return tokens.filter(token => this.TECHNICAL_KEYWORDS.has(token));
  }

  /**
   * Extract keywords optimized for memory search
   * Returns top N most relevant keywords
   */
  extractForSearch(toolArgs: any, maxKeywords: number = 5): string[] {
    const extracted = this.extract(toolArgs);

    // Prioritize technical terms
    const topKeywords = [
      ...extracted.technicalTerms,
      ...extracted.keywords.filter(k => !extracted.technicalTerms.includes(k))
    ];

    return topKeywords.slice(0, maxKeywords);
  }

  /**
   * Extract keywords as a search query string
   */
  extractAsQuery(toolArgs: any): string {
    const keywords = this.extractForSearch(toolArgs);
    return keywords.join(' ');
  }
}
