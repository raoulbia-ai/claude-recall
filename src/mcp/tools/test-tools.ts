import { MCPTool, MCPContext } from '../server';
import { MemoryService } from '../../services/memory';
import { LoggingService } from '../../services/logging';
import { SearchMonitor } from '../../services/search-monitor';
import { TestOrchestrator } from '../../testing/test-orchestrator';
import { ObservableDatabase } from '../../testing/observable-database';
import { MockClaude } from '../../testing/mock-claude';
import { ScenarioRunner } from '../../testing/scenario-runner';

export class TestTools {
  private tools: MCPTool[] = [];
  private testOrchestrator: TestOrchestrator;
  
  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.testOrchestrator = new TestOrchestrator(memoryService, logger);
    this.registerTools();
  }
  
  private registerTools(): void {
    this.tools = [
      {
        name: 'mcp__test__run_scenario',
        description: 'Run a predefined test scenario for memory compliance',
        inputSchema: {
          type: 'object',
          properties: {
            scenario: { 
              type: 'string', 
              description: 'Name of the scenario to run (e.g., "memory_persistence", "search_compliance", "rate_limiting")' 
            },
            params: { 
              type: 'object', 
              description: 'Optional parameters for the scenario' 
            }
          },
          required: ['scenario']
        },
        handler: this.handleRunScenario.bind(this)
      },
      {
        name: 'mcp__test__observe_behavior',
        description: 'Observe and analyze system behavior for a specific action',
        inputSchema: {
          type: 'object',
          properties: {
            action: { 
              type: 'string', 
              description: 'Action to observe (e.g., "store_memory", "create_file", "search")' 
            },
            params: { 
              type: 'object', 
              description: 'Parameters for the action' 
            }
          },
          required: ['action']
        },
        handler: this.handleObserveBehavior.bind(this)
      },
      {
        name: 'mcp__test__validate_fix',
        description: 'Validate a proposed fix by running relevant tests',
        inputSchema: {
          type: 'object',
          properties: {
            issueId: { 
              type: 'string', 
              description: 'ID of the issue being fixed' 
            },
            fixDescription: { 
              type: 'string', 
              description: 'Description of the fix applied' 
            },
            testScenarios: { 
              type: 'array', 
              description: 'List of scenarios to test',
              items: { type: 'string' }
            }
          },
          required: ['issueId', 'fixDescription']
        },
        handler: this.handleValidateFix.bind(this)
      },
      {
        name: 'mcp__test__get_results',
        description: 'Get detailed test results and history',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: { 
              type: 'string', 
              description: 'Optional session ID to filter results' 
            },
            limit: { 
              type: 'number', 
              description: 'Maximum number of results to return' 
            }
          }
        },
        handler: this.handleGetResults.bind(this)
      },
      {
        name: 'mcp__test__simulate_claude',
        description: 'Simulate Claude agent behavior with configurable compliance',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { 
              type: 'string', 
              description: 'Prompt to simulate' 
            },
            complianceLevel: { 
              type: 'number', 
              description: 'Compliance level (0-1) for memory search behavior' 
            },
            expectedBehavior: { 
              type: 'object', 
              description: 'Expected behavior to validate against' 
            }
          },
          required: ['prompt']
        },
        handler: this.handleSimulateClaude.bind(this)
      },
      {
        name: 'mcp__test__memory_scenario',
        description: 'Test memory search compliance with live scenarios',
        inputSchema: {
          type: 'object',
          properties: {
            storeContent: { 
              type: 'string', 
              description: 'Memory content to store' 
            },
            testAction: { 
              type: 'string', 
              description: 'Action to test after storing memory' 
            }
          },
          required: ['storeContent', 'testAction']
        },
        handler: this.handleMemoryScenario.bind(this)
      }
    ];
  }
  
  private async handleRunScenario(input: any, context: MCPContext): Promise<any> {
    try {
      const { scenario, params = {} } = input;
      
      this.logger.info('TestTools', `Running scenario: ${scenario}`, {
        sessionId: context.sessionId,
        params
      });
      
      const result = await this.testOrchestrator.runScenario({
        name: scenario,
        params,
        sessionId: context.sessionId
      });
      
      return {
        scenario,
        status: result.status,
        observations: result.observations,
        insights: result.insights,
        reproduction: result.reproduction,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('TestTools', 'Failed to run scenario', error);
      throw error;
    }
  }
  
  private async handleObserveBehavior(input: any, context: MCPContext): Promise<any> {
    try {
      const { action, params = {} } = input;
      
      const observation = await this.testOrchestrator.observeBehavior(
        action,
        params,
        context.sessionId
      );
      
      return {
        action,
        observed: observation.observed,
        databaseChanges: observation.databaseChanges,
        searchCalls: observation.searchCalls,
        complianceStatus: observation.complianceStatus,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('TestTools', 'Failed to observe behavior', error);
      throw error;
    }
  }
  
  private async handleValidateFix(input: any, context: MCPContext): Promise<any> {
    try {
      const { issueId, fixDescription, testScenarios = [] } = input;
      
      const validation = await this.testOrchestrator.validateFix({
        issueId,
        fixDescription,
        testScenarios,
        sessionId: context.sessionId
      });
      
      return {
        issueId,
        fixDescription,
        validationPassed: validation.passed,
        testResults: validation.results,
        confidence: validation.confidence,
        recommendations: validation.recommendations,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('TestTools', 'Failed to validate fix', error);
      throw error;
    }
  }
  
  private async handleGetResults(input: any, context: MCPContext): Promise<any> {
    try {
      const { sessionId, limit = 10 } = input;
      
      const results = await this.testOrchestrator.getTestHistory({
        sessionId: sessionId || context.sessionId,
        limit
      });
      
      return {
        results: results.history,
        summary: results.summary,
        trends: results.trends,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('TestTools', 'Failed to get results', error);
      throw error;
    }
  }
  
  private async handleSimulateClaude(input: any, context: MCPContext): Promise<any> {
    try {
      const { prompt, complianceLevel = 0.5, expectedBehavior } = input;
      
      const simulation = await this.testOrchestrator.simulateClaudeInteraction({
        prompt,
        complianceLevel,
        expectedBehavior,
        sessionId: context.sessionId
      });
      
      return {
        prompt,
        toolsSelected: simulation.toolsSelected,
        executionResults: simulation.executionResults,
        databaseChanges: simulation.databaseChanges,
        searchCallsMade: simulation.searchCallsMade,
        complianceMatched: simulation.complianceMatched,
        behaviorAsExpected: simulation.behaviorAsExpected,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('TestTools', 'Failed to simulate Claude', error);
      throw error;
    }
  }
  
  private async handleMemoryScenario(input: any, context: MCPContext): Promise<any> {
    try {
      const { storeContent, testAction } = input;
      
      // Store memory
      await this.memoryService.store({
        key: `test_memory_${Date.now()}`,
        value: { content: storeContent },
        type: 'test',
        context: { sessionId: context.sessionId }
      });
      
      // Create observable database to track changes
      const observer = new ObservableDatabase(this.memoryService);
      observer.startTracking();
      
      // Track search calls
      const searchMonitor = SearchMonitor.getInstance();
      const searchesBefore = searchMonitor.getRecentSearches(1).length;
      
      // Execute test action
      let actionResult: any;
      let actionError: Error | null = null;
      
      try {
        // Parse and execute the test action
        if (testAction.startsWith('create_file')) {
          // Simulate file creation
          actionResult = { action: 'create_file', executed: true };
        } else if (testAction.startsWith('search')) {
          // Simulate search
          const query = testAction.match(/search\(['"](.+)['"]\)/)?.[1] || 'test';
          actionResult = await this.memoryService.search(query);
        } else {
          actionResult = { action: testAction, executed: true };
        }
      } catch (err) {
        actionError = err as Error;
      }
      
      // Check if search was called
      const searchesAfter = searchMonitor.getRecentSearches(1).length;
      const searchCalled = searchesAfter > searchesBefore;
      
      // Get database changes
      const dbChanges = observer.getChanges();
      observer.stopTracking();
      
      // Analyze compliance
      const issues: string[] = [];
      if (!searchCalled && testAction.includes('create')) {
        issues.push('Search not called before file creation');
      }
      
      return {
        success: searchCalled && !actionError,
        searchCalled,
        result: actionResult,
        error: actionError?.message,
        databaseChanges: dbChanges,
        issues,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('TestTools', 'Failed to run memory scenario', error);
      throw error;
    }
  }
  
  getTools(): MCPTool[] {
    return this.tools;
  }
}