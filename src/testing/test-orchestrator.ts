import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { ObservableDatabase } from './observable-database';
import { MockClaude } from './mock-claude';
import { ScenarioRunner } from './scenario-runner';
import { AutoCorrectionEngine } from './auto-correction-engine';

export interface TestScenario {
  name: string;
  params?: any;
  sessionId?: string;
}

export interface TestResult {
  scenario: string;
  status: 'passed' | 'failed' | 'partial';
  observations: {
    memoriesStored: any[];
    searchesPerformed: any[];
    filesCreated: any[];
    complianceViolations: any[];
  };
  insights: {
    rootCause?: string;
    suggestedFix?: string;
    confidenceLevel: number;
  };
  reproduction: {
    steps: string[];
    environment: any;
  };
}

export interface ObservationResult {
  observed: any;
  databaseChanges: any[];
  searchCalls: any[];
  complianceStatus: 'compliant' | 'non-compliant' | 'partial';
}

export interface ValidationResult {
  passed: boolean;
  results: any[];
  confidence: number;
  recommendations: string[];
}

export interface SimulationResult {
  toolsSelected: any[];
  executionResults: any[];
  databaseChanges: any[];
  searchCallsMade: any[];
  complianceMatched: boolean;
  behaviorAsExpected: boolean;
}

export interface TestHistory {
  history: any[];
  summary: {
    totalTests: number;
    passed: number;
    failed: number;
    complianceRate: number;
  };
  trends: {
    improvementRate: number;
    commonIssues: string[];
  };
}

export class TestOrchestrator {
  private observableDb: ObservableDatabase;
  private mockClaude: MockClaude;
  private scenarioRunner: ScenarioRunner;
  private autoCorrectionEngine: AutoCorrectionEngine;
  private testHistory: Map<string, any[]> = new Map();
  
  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.observableDb = new ObservableDatabase(memoryService);
    this.mockClaude = new MockClaude(memoryService, logger);
    this.scenarioRunner = new ScenarioRunner(memoryService, logger);
    this.autoCorrectionEngine = new AutoCorrectionEngine(memoryService, logger);
  }
  
  async runScenario(scenario: TestScenario): Promise<TestResult> {
    const startTime = Date.now();
    this.logger.info('TestOrchestrator', `Running scenario: ${scenario.name}`, scenario);
    
    // Start tracking database changes
    this.observableDb.startTracking();
    
    try {
      // Run the scenario
      const scenarioResult = await this.scenarioRunner.run(scenario.name, scenario.params);
      
      // Get observations
      const dbChanges = this.observableDb.getChanges();
      this.observableDb.stopTracking();
      
      // Analyze results
      const analysis = this.analyzeResults(scenarioResult, dbChanges);
      
      // Build test result
      const result: TestResult = {
        scenario: scenario.name,
        status: analysis.status,
        observations: {
          memoriesStored: dbChanges.filter(c => c.operation === 'INSERT'),
          searchesPerformed: scenarioResult.searches || [],
          filesCreated: scenarioResult.files || [],
          complianceViolations: analysis.violations
        },
        insights: {
          rootCause: analysis.rootCause,
          suggestedFix: analysis.suggestedFix,
          confidenceLevel: analysis.confidence
        },
        reproduction: {
          steps: scenarioResult.steps || [],
          environment: {
            timestamp: startTime,
            sessionId: scenario.sessionId,
            duration: Date.now() - startTime
          }
        }
      };
      
      // Store in history
      this.addToHistory(scenario.sessionId || 'default', result);
      
      return result;
      
    } catch (error) {
      this.logger.error('TestOrchestrator', 'Scenario execution failed', error);
      this.observableDb.stopTracking();
      
      return {
        scenario: scenario.name,
        status: 'failed',
        observations: {
          memoriesStored: [],
          searchesPerformed: [],
          filesCreated: [],
          complianceViolations: [{
            type: 'execution_error',
            message: (error as Error).message
          }]
        },
        insights: {
          rootCause: (error as Error).message,
          suggestedFix: 'Check scenario configuration and system state',
          confidenceLevel: 0.3
        },
        reproduction: {
          steps: [`Error: ${(error as Error).message}`],
          environment: {
            timestamp: startTime,
            sessionId: scenario.sessionId,
            duration: Date.now() - startTime
          }
        }
      };
    }
  }
  
  async observeBehavior(action: string, params: any, sessionId: string): Promise<ObservationResult> {
    this.logger.info('TestOrchestrator', `Observing behavior: ${action}`, { params, sessionId });
    
    // Start observation
    this.observableDb.startTracking();
    const searchesBefore = this.getSearchCount();
    
    try {
      // Execute the action
      let observed: any;
      
      switch (action) {
        case 'store_memory':
          observed = await this.memoryService.store({
            key: params.key || `test_${Date.now()}`,
            value: params.value || { content: 'test' },
            type: params.type || 'test',
            context: { sessionId }
          });
          break;
          
        case 'search':
          observed = await this.memoryService.search(params.query || 'test');
          break;
          
        case 'create_file':
          // Simulate file creation
          observed = { action: 'create_file', path: params.path || 'test.js' };
          break;
          
        default:
          observed = { action, params };
      }
      
      // Get observations
      const dbChanges = this.observableDb.getChanges();
      const searchesAfter = this.getSearchCount();
      const searchCalls = searchesAfter - searchesBefore;
      
      // Determine compliance
      let complianceStatus: 'compliant' | 'non-compliant' | 'partial' = 'compliant';
      
      if (action === 'create_file' && searchCalls === 0) {
        complianceStatus = 'non-compliant';
      } else if (action === 'store_memory' && dbChanges.length === 0) {
        complianceStatus = 'partial';
      }
      
      return {
        observed,
        databaseChanges: dbChanges,
        searchCalls: Array(searchCalls).fill({ action: 'search', timestamp: Date.now() }),
        complianceStatus
      };
      
    } finally {
      this.observableDb.stopTracking();
    }
  }
  
  async validateFix(params: {
    issueId: string;
    fixDescription: string;
    testScenarios: string[];
    sessionId: string;
  }): Promise<ValidationResult> {
    this.logger.info('TestOrchestrator', `Validating fix for issue: ${params.issueId}`, params);
    
    const results: any[] = [];
    let passedCount = 0;
    
    // Run test scenarios
    for (const scenarioName of params.testScenarios) {
      const result = await this.runScenario({
        name: scenarioName,
        sessionId: params.sessionId
      });
      
      results.push({
        scenario: scenarioName,
        status: result.status,
        violations: result.observations.complianceViolations
      });
      
      if (result.status === 'passed') {
        passedCount++;
      }
    }
    
    // Calculate confidence
    const confidence = params.testScenarios.length > 0
      ? passedCount / params.testScenarios.length
      : 0;
    
    // Generate recommendations
    const recommendations: string[] = [];
    
    if (confidence < 0.5) {
      recommendations.push('Fix does not adequately address the issue');
      recommendations.push('Review the implementation and test coverage');
    } else if (confidence < 0.8) {
      recommendations.push('Fix partially addresses the issue');
      recommendations.push('Consider additional edge cases');
    } else {
      recommendations.push('Fix appears to be effective');
      recommendations.push('Monitor for regression in production');
    }
    
    return {
      passed: confidence >= 0.8,
      results,
      confidence,
      recommendations
    };
  }
  
  async simulateClaudeInteraction(params: {
    prompt: string;
    complianceLevel: number;
    expectedBehavior?: any;
    sessionId: string;
  }): Promise<SimulationResult> {
    this.logger.info('TestOrchestrator', 'Simulating Claude interaction', params);
    
    // Set compliance level
    this.mockClaude.setComplianceLevel(params.complianceLevel);
    
    // Start tracking
    this.observableDb.startTracking();
    const searchesBefore = this.getSearchCount();
    
    try {
      // Simulate Claude processing the prompt
      const interaction = await this.mockClaude.simulateInteraction(params.prompt);
      
      // Get observations
      const dbChanges = this.observableDb.getChanges();
      const searchesAfter = this.getSearchCount();
      
      // Check if behavior matches expectations
      let behaviorAsExpected = true;
      if (params.expectedBehavior) {
        behaviorAsExpected = this.compareBehavior(
          interaction,
          params.expectedBehavior
        );
      }
      
      // Check compliance
      const searchCallsMade = searchesAfter - searchesBefore;
      const complianceMatched = searchCallsMade > 0 || !params.prompt.includes('create');
      
      return {
        toolsSelected: interaction.toolsSelected,
        executionResults: interaction.executionResults,
        databaseChanges: dbChanges,
        searchCallsMade: Array(searchCallsMade).fill({ action: 'search' }),
        complianceMatched,
        behaviorAsExpected
      };
      
    } finally {
      this.observableDb.stopTracking();
    }
  }
  
  async getTestHistory(params: {
    sessionId?: string;
    limit?: number;
  }): Promise<TestHistory> {
    const sessionId = params.sessionId || 'default';
    const history = this.testHistory.get(sessionId) || [];
    const limitedHistory = params.limit ? history.slice(-params.limit) : history;
    
    // Calculate summary
    const totalTests = limitedHistory.length;
    const passed = limitedHistory.filter(t => t.status === 'passed').length;
    const failed = limitedHistory.filter(t => t.status === 'failed').length;
    const complianceRate = totalTests > 0 ? passed / totalTests : 0;
    
    // Analyze trends
    const recentTests = limitedHistory.slice(-10);
    const recentPassed = recentTests.filter(t => t.status === 'passed').length;
    const improvementRate = recentTests.length > 0 ? recentPassed / recentTests.length : 0;
    
    // Find common issues
    const issues: Map<string, number> = new Map();
    for (const test of limitedHistory) {
      if (test.observations?.complianceViolations) {
        for (const violation of test.observations.complianceViolations) {
          const key = violation.type || violation.message;
          issues.set(key, (issues.get(key) || 0) + 1);
        }
      }
    }
    
    const commonIssues = Array.from(issues.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue]) => issue);
    
    return {
      history: limitedHistory,
      summary: {
        totalTests,
        passed,
        failed,
        complianceRate
      },
      trends: {
        improvementRate,
        commonIssues
      }
    };
  }
  
  private analyzeResults(scenarioResult: any, dbChanges: any[]): any {
    const violations: any[] = [];
    let status: 'passed' | 'failed' | 'partial' = 'passed';
    let rootCause: string | undefined;
    let suggestedFix: string | undefined;
    let confidence = 1.0;
    
    // Check for search compliance
    if (scenarioResult.expectedSearches && !scenarioResult.searchPerformed) {
      violations.push({
        type: 'missing_search',
        message: 'Expected search was not performed'
      });
      status = 'failed';
      rootCause = 'Memory search not triggered before action';
      suggestedFix = 'Ensure search is called in the appropriate hooks or middleware';
      confidence = 0.8;
    }
    
    // Check for memory persistence
    if (scenarioResult.expectedMemory && dbChanges.length === 0) {
      violations.push({
        type: 'memory_not_stored',
        message: 'Expected memory was not persisted'
      });
      status = status === 'failed' ? 'failed' : 'partial';
      rootCause = rootCause || 'Memory storage mechanism not functioning';
      suggestedFix = suggestedFix || 'Check database connection and storage logic';
      confidence = Math.min(confidence, 0.6);
    }
    
    // Check for rate limiting
    if (scenarioResult.rateLimitExpected && !scenarioResult.rateLimitTriggered) {
      violations.push({
        type: 'rate_limit_bypass',
        message: 'Rate limiting did not trigger as expected'
      });
      status = 'partial';
      rootCause = rootCause || 'Rate limiter not properly configured';
      suggestedFix = suggestedFix || 'Review rate limiter thresholds and implementation';
      confidence = Math.min(confidence, 0.7);
    }
    
    return {
      status,
      violations,
      rootCause,
      suggestedFix,
      confidence
    };
  }
  
  private addToHistory(sessionId: string, result: TestResult): void {
    if (!this.testHistory.has(sessionId)) {
      this.testHistory.set(sessionId, []);
    }
    
    const history = this.testHistory.get(sessionId)!;
    history.push(result);
    
    // Keep only last 100 results per session
    if (history.length > 100) {
      history.shift();
    }
  }
  
  private getSearchCount(): number {
    // In a real implementation, this would query the search monitor
    // For now, return a mock value
    return Math.floor(Math.random() * 10);
  }
  
  private compareBehavior(actual: any, expected: any): boolean {
    // Simple comparison for now
    // In a real implementation, this would do deep comparison
    return JSON.stringify(actual.toolsSelected) === JSON.stringify(expected.toolsSelected);
  }
}