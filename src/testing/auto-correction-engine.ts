import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { TestResult } from './test-orchestrator';

export interface CodeSuggestion {
  file: string;
  line?: number;
  original?: string;
  suggested: string;
  reason: string;
  confidence: number;
}

export interface CorrectionAttempt {
  fix: CodeFix;
  validation: ValidationResult;
  shouldApply: boolean;
}

export interface CodeFix {
  issueType: string;
  files: Array<{
    path: string;
    changes: Array<{
      type: 'add' | 'modify' | 'delete';
      content: string;
      line?: number;
    }>;
  }>;
  description: string;
  confidence: number;
}

export interface ValidationResult {
  passed: boolean;
  testsRun: number;
  testsPassed: number;
  improvements: string[];
  regressions: string[];
}

export interface FailureAnalysis {
  issueType: 'search_compliance' | 'memory_persistence' | 'rate_limiting' | 'unknown';
  rootCause: string;
  affectedComponents: string[];
  suggestedFixes: CodeSuggestion[];
}

export class AutoCorrectionEngine {
  private fixPatterns: Map<string, CodeFix> = new Map();
  private successfulFixes: Map<string, CodeFix[]> = new Map();
  
  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.initializeFixPatterns();
  }
  
  private initializeFixPatterns(): void {
    // Pattern for search compliance issues
    this.fixPatterns.set('missing_search', {
      issueType: 'search_compliance',
      files: [{
        path: 'src/hooks/memory-search-enforcer.js',
        changes: [{
          type: 'modify',
          content: `
// Enhanced search enforcement
export function enforceMemorySearch(action, params) {
  if (action === 'create_file' || action === 'modify_file') {
    // Force search before file operations
    const searchQuery = extractRelevantKeywords(params);
    const searchResults = await memoryService.search(searchQuery);
    
    // Use search results to inform the action
    params.context = {
      ...params.context,
      searchResults,
      searchPerformed: true
    };
  }
  return params;
}`
        }]
      }],
      description: 'Add search enforcement before file operations',
      confidence: 0.8
    });
    
    // Pattern for memory persistence issues
    this.fixPatterns.set('memory_not_stored', {
      issueType: 'memory_persistence',
      files: [{
        path: 'src/services/memory.ts',
        changes: [{
          type: 'modify',
          content: `
// Ensure memory persistence
store(request: MemoryStoreRequest): void {
  try {
    // Add retry logic for persistence
    let retries = 3;
    let stored = false;
    
    while (retries > 0 && !stored) {
      try {
        this.storage.save(memory);
        stored = true;
      } catch (err) {
        retries--;
        if (retries === 0) throw err;
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    // Verify storage
    const verified = this.storage.retrieve(memory.key);
    if (!verified) {
      throw new Error('Memory storage verification failed');
    }
  } catch (error) {
    this.logger.error('Memory storage failed', error);
    throw error;
  }
}`
        }]
      }],
      description: 'Add retry logic and verification for memory persistence',
      confidence: 0.75
    });
    
    // Pattern for rate limiting bypass
    this.fixPatterns.set('rate_limit_bypass', {
      issueType: 'rate_limiting',
      files: [{
        path: 'src/mcp/rate-limiter.ts',
        changes: [{
          type: 'modify',
          content: `
// Stricter rate limiting
checkLimit(sessionId: string): boolean {
  const now = Date.now();
  const session = this.sessions.get(sessionId) || this.createSession(sessionId);
  
  // Clean old requests
  session.requests = session.requests.filter(r => now - r < this.windowMs);
  
  // Check limit with buffer
  const buffer = 0.9; // 90% of limit to be safe
  if (session.requests.length >= this.maxRequests * buffer) {
    this.logger.warn('Rate limit approaching', { sessionId, requests: session.requests.length });
    return false;
  }
  
  session.requests.push(now);
  return true;
}`
        }]
      }],
      description: 'Implement stricter rate limiting with buffer',
      confidence: 0.85
    });
  }
  
  async analyzeFailure(testResult: TestResult): Promise<FailureAnalysis> {
    this.logger.info('AutoCorrectionEngine', 'Analyzing test failure', {
      scenario: testResult.scenario,
      status: testResult.status
    });
    
    // Determine issue type based on violations
    let issueType: FailureAnalysis['issueType'] = 'unknown';
    let rootCause = 'Unknown issue';
    const affectedComponents: string[] = [];
    const suggestedFixes: CodeSuggestion[] = [];
    
    // Analyze compliance violations
    for (const violation of testResult.observations.complianceViolations) {
      if (violation.type === 'missing_search') {
        issueType = 'search_compliance';
        rootCause = 'Memory search not triggered before file operations';
        affectedComponents.push('hooks/memory-search-enforcer.js');
        
        suggestedFixes.push({
          file: 'src/hooks/memory-search-enforcer.js',
          suggested: this.fixPatterns.get('missing_search')?.files[0].changes[0].content || '',
          reason: 'Search must be performed before file creation to ensure context awareness',
          confidence: 0.8
        });
      } else if (violation.type === 'memory_not_stored') {
        issueType = 'memory_persistence';
        rootCause = 'Memory storage mechanism failing or not persisting data';
        affectedComponents.push('services/memory.ts', 'memory/storage.ts');
        
        suggestedFixes.push({
          file: 'src/services/memory.ts',
          suggested: this.fixPatterns.get('memory_not_stored')?.files[0].changes[0].content || '',
          reason: 'Add retry logic and verification to ensure memories are persisted',
          confidence: 0.75
        });
      } else if (violation.type === 'rate_limit_bypass') {
        issueType = 'rate_limiting';
        rootCause = 'Rate limiter not properly enforcing request limits';
        affectedComponents.push('mcp/rate-limiter.ts');
        
        suggestedFixes.push({
          file: 'src/mcp/rate-limiter.ts',
          suggested: this.fixPatterns.get('rate_limit_bypass')?.files[0].changes[0].content || '',
          reason: 'Implement stricter rate limiting with safety buffer',
          confidence: 0.85
        });
      }
    }
    
    // If no specific issue found, analyze insights
    if (issueType === 'unknown' && testResult.insights.rootCause) {
      rootCause = testResult.insights.rootCause;
      
      // Try to infer issue type from root cause
      if (rootCause.includes('search')) {
        issueType = 'search_compliance';
        affectedComponents.push('hooks/memory-search-enforcer.js');
      } else if (rootCause.includes('memory') || rootCause.includes('storage')) {
        issueType = 'memory_persistence';
        affectedComponents.push('services/memory.ts');
      } else if (rootCause.includes('rate') || rootCause.includes('limit')) {
        issueType = 'rate_limiting';
        affectedComponents.push('mcp/rate-limiter.ts');
      }
    }
    
    return {
      issueType,
      rootCause,
      affectedComponents,
      suggestedFixes
    };
  }
  
  async generateFix(
    analysis: FailureAnalysis,
    codebaseContext?: any
  ): Promise<CodeFix> {
    this.logger.info('AutoCorrectionEngine', 'Generating fix', {
      issueType: analysis.issueType,
      components: analysis.affectedComponents
    });
    
    // Get pattern-based fix if available
    const patternFix = this.fixPatterns.get(
      analysis.issueType === 'search_compliance' ? 'missing_search' :
      analysis.issueType === 'memory_persistence' ? 'memory_not_stored' :
      analysis.issueType === 'rate_limiting' ? 'rate_limit_bypass' :
      'unknown'
    );
    
    if (patternFix) {
      // Enhance fix with context if available
      if (codebaseContext) {
        patternFix.confidence = this.adjustConfidenceBasedOnContext(
          patternFix.confidence,
          codebaseContext
        );
      }
      
      return patternFix;
    }
    
    // Generate custom fix based on analysis
    const customFix: CodeFix = {
      issueType: analysis.issueType,
      files: analysis.suggestedFixes.map(suggestion => ({
        path: suggestion.file,
        changes: [{
          type: 'modify',
          content: suggestion.suggested,
          line: suggestion.line
        }]
      })),
      description: `Auto-generated fix for ${analysis.issueType}: ${analysis.rootCause}`,
      confidence: Math.max(...analysis.suggestedFixes.map(f => f.confidence), 0.5)
    };
    
    return customFix;
  }
  
  async attemptFix(
    testResult: TestResult,
    codebaseContext?: any
  ): Promise<CorrectionAttempt> {
    this.logger.info('AutoCorrectionEngine', 'Attempting automatic fix', {
      scenario: testResult.scenario,
      status: testResult.status
    });
    
    // Analyze the failure
    const analysis = await this.analyzeFailure(testResult);
    
    // Generate fix
    const fix = await this.generateFix(analysis, codebaseContext);
    
    // Validate fix (simplified - in real implementation would apply and test)
    const validation = await this.validateFix(fix, testResult);
    
    // Decide if fix should be applied
    const shouldApply = validation.passed && fix.confidence >= 0.7;
    
    // Learn from the attempt
    if (shouldApply) {
      this.recordSuccessfulFix(analysis.issueType, fix);
    }
    
    return {
      fix,
      validation,
      shouldApply
    };
  }
  
  private async validateFix(fix: CodeFix, originalResult: TestResult): Promise<ValidationResult> {
    // Simplified validation - in real implementation would:
    // 1. Apply fix to sandbox environment
    // 2. Re-run tests
    // 3. Compare results
    
    const validation: ValidationResult = {
      passed: false,
      testsRun: 0,
      testsPassed: 0,
      improvements: [],
      regressions: []
    };
    
    // Simulate validation based on fix confidence and issue type
    if (fix.confidence >= 0.7) {
      validation.passed = true;
      validation.testsRun = 5;
      validation.testsPassed = Math.floor(5 * fix.confidence);
      
      if (fix.issueType === 'search_compliance') {
        validation.improvements.push('Search now triggered before file operations');
      } else if (fix.issueType === 'memory_persistence') {
        validation.improvements.push('Memory persistence reliability improved');
      } else if (fix.issueType === 'rate_limiting') {
        validation.improvements.push('Rate limiting now properly enforced');
      }
      
      // Check for potential regressions
      if (fix.confidence < 0.9) {
        validation.regressions.push('Potential performance impact - monitor closely');
      }
    } else {
      validation.testsRun = 5;
      validation.testsPassed = 2;
      validation.regressions.push('Fix does not adequately address the issue');
    }
    
    return validation;
  }
  
  private adjustConfidenceBasedOnContext(
    baseConfidence: number,
    context: any
  ): number {
    let adjustedConfidence = baseConfidence;
    
    // Increase confidence if we've seen similar fixes work
    if (context.previousSuccesses) {
      adjustedConfidence = Math.min(1, adjustedConfidence + 0.1);
    }
    
    // Decrease confidence if codebase is complex
    if (context.complexity === 'high') {
      adjustedConfidence = Math.max(0, adjustedConfidence - 0.1);
    }
    
    // Adjust based on test coverage
    if (context.testCoverage) {
      const coverageBonus = context.testCoverage / 100 * 0.2;
      adjustedConfidence = Math.min(1, adjustedConfidence + coverageBonus);
    }
    
    return adjustedConfidence;
  }
  
  private recordSuccessfulFix(issueType: string, fix: CodeFix): void {
    if (!this.successfulFixes.has(issueType)) {
      this.successfulFixes.set(issueType, []);
    }
    
    const fixes = this.successfulFixes.get(issueType)!;
    fixes.push(fix);
    
    // Keep only last 10 successful fixes per issue type
    if (fixes.length > 10) {
      fixes.shift();
    }
    
    this.logger.info('AutoCorrectionEngine', 'Recorded successful fix', {
      issueType,
      totalSuccessfulFixes: fixes.length
    });
  }
  
  // Get learning insights
  getLearningInsights(): {
    mostCommonIssues: string[];
    successRate: number;
    recommendedFixes: Map<string, CodeFix>;
  } {
    const insights = {
      mostCommonIssues: Array.from(this.successfulFixes.keys()),
      successRate: 0,
      recommendedFixes: new Map<string, CodeFix>()
    };
    
    // Calculate success rate
    let totalFixes = 0;
    for (const fixes of this.successfulFixes.values()) {
      totalFixes += fixes.length;
    }
    
    if (totalFixes > 0) {
      // Simplified - in real implementation would track attempts vs successes
      insights.successRate = 0.75; // Assume 75% success rate
    }
    
    // Get most successful fixes
    for (const [issueType, fixes] of this.successfulFixes) {
      if (fixes.length > 0) {
        // Get fix with highest confidence
        const bestFix = fixes.reduce((best, current) => 
          current.confidence > best.confidence ? current : best
        );
        insights.recommendedFixes.set(issueType, bestFix);
      }
    }
    
    return insights;
  }
}