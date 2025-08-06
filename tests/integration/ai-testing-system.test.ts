import { MCPServer } from '../../src/mcp/server';
import { TestOrchestrator } from '../../src/testing/test-orchestrator';
import { ObservableDatabase } from '../../src/testing/observable-database';
import { MockClaude } from '../../src/testing/mock-claude';
import { ScenarioRunner } from '../../src/testing/scenario-runner';
import { AutoCorrectionEngine } from '../../src/testing/auto-correction-engine';
import { MemoryService } from '../../src/services/memory';
import { LoggingService } from '../../src/services/logging';
import { DatabaseManager } from '../../src/services/database-manager';
import * as path from 'path';
import * as fs from 'fs';

describe('AI Testing System Integration', () => {
  let server: MCPServer;
  let testOrchestrator: TestOrchestrator;
  let memoryService: MemoryService;
  let logger: LoggingService;
  let dbManager: DatabaseManager;
  const testDb = path.join(__dirname, '../test-claude-recall.db');
  
  beforeAll(async () => {
    // Clean up any existing test database
    if (fs.existsSync(testDb)) {
      fs.unlinkSync(testDb);
    }
    
    // Initialize services
    process.env.CLAUDE_RECALL_DB = testDb;
    memoryService = MemoryService.getInstance();
    logger = LoggingService.getInstance();
    dbManager = DatabaseManager.getInstance();
    
    // Initialize server
    server = new MCPServer();
    
    // Initialize test orchestrator
    testOrchestrator = new TestOrchestrator(memoryService, logger);
  });
  
  afterAll(async () => {
    await server.stop();
    dbManager.close();
    
    // Clean up test database
    if (fs.existsSync(testDb)) {
      fs.unlinkSync(testDb);
    }
  });
  
  describe('Test Orchestrator', () => {
    test('should run memory persistence scenario successfully', async () => {
      const result = await testOrchestrator.runScenario({
        name: 'memory_persistence',
        sessionId: 'test_session_1'
      });
      
      expect(result).toBeDefined();
      expect(result.scenario).toBe('memory_persistence');
      expect(result.status).toMatch(/passed|partial/);
      expect(result.observations.memoriesStored.length).toBeGreaterThan(0);
    });
    
    test('should detect search compliance violations', async () => {
      const result = await testOrchestrator.runScenario({
        name: 'search_compliance',
        sessionId: 'test_session_2'
      });
      
      expect(result).toBeDefined();
      expect(result.scenario).toBe('search_compliance');
      
      // Check if search compliance is tracked
      if (result.status === 'failed') {
        expect(result.observations.complianceViolations).toContainEqual(
          expect.objectContaining({
            type: 'missing_search'
          })
        );
      }
    });
    
    test('should observe behavior and track database changes', async () => {
      const observation = await testOrchestrator.observeBehavior(
        'store_memory',
        { value: { content: 'Test memory for observation' } },
        'test_session_3'
      );
      
      expect(observation).toBeDefined();
      expect(observation.databaseChanges.length).toBeGreaterThan(0);
      expect(observation.complianceStatus).toBeDefined();
    });
    
    test('should validate fixes with multiple scenarios', async () => {
      const validation = await testOrchestrator.validateFix({
        issueId: 'TEST-001',
        fixDescription: 'Added search enforcement hook',
        testScenarios: ['memory_persistence', 'search_compliance'],
        sessionId: 'test_session_4'
      });
      
      expect(validation).toBeDefined();
      expect(validation.passed).toBeDefined();
      expect(validation.confidence).toBeGreaterThanOrEqual(0);
      expect(validation.confidence).toBeLessThanOrEqual(1);
      expect(validation.recommendations.length).toBeGreaterThan(0);
    });
    
    test('should simulate Claude interaction with different compliance levels', async () => {
      const highCompliance = await testOrchestrator.simulateClaudeInteraction({
        prompt: 'Create a new test file for user authentication',
        complianceLevel: 0.9,
        sessionId: 'test_session_5'
      });
      
      const lowCompliance = await testOrchestrator.simulateClaudeInteraction({
        prompt: 'Create a new test file for user authentication',
        complianceLevel: 0.1,
        sessionId: 'test_session_6'
      });
      
      expect(highCompliance.toolsSelected.length).toBeGreaterThan(0);
      expect(lowCompliance.toolsSelected.length).toBeGreaterThan(0);
      
      // High compliance should likely include search
      const highComplianceHasSearch = highCompliance.toolsSelected.some(
        t => t.name.includes('search')
      );
      const lowComplianceHasSearch = lowCompliance.toolsSelected.some(
        t => t.name.includes('search')
      );
      
      // Generally expect high compliance to search more often
      expect(highComplianceHasSearch || !lowComplianceHasSearch).toBe(true);
    });
  });
  
  describe('Observable Database', () => {
    test('should track database changes during operations', async () => {
      const observer = new ObservableDatabase(memoryService);
      
      observer.startTracking();
      
      // Perform some operations
      await memoryService.store({
        key: 'test_observable_1',
        value: { content: 'Observable test 1' },
        type: 'test',
        context: { sessionId: 'obs_test' }
      });
      
      await memoryService.search('observable');
      
      const changes = observer.getChanges();
      observer.stopTracking();
      
      expect(changes.length).toBeGreaterThan(0);
      expect(changes).toContainEqual(
        expect.objectContaining({
          operation: 'INSERT',
          table: 'memories'
        })
      );
      expect(changes).toContainEqual(
        expect.objectContaining({
          operation: 'SELECT',
          table: 'memories'
        })
      );
    });
    
    test('should provide statistics on database operations', async () => {
      const observer = new ObservableDatabase(memoryService);
      
      observer.startTracking();
      
      // Perform multiple operations
      for (let i = 0; i < 3; i++) {
        await memoryService.store({
          key: `test_stats_${i}`,
          value: { content: `Stat test ${i}` },
          type: 'test',
          context: { sessionId: 'stats_test' }
        });
      }
      
      const stats = observer.getStatistics();
      observer.stopTracking();
      
      expect(stats.totalChanges).toBeGreaterThanOrEqual(3);
      expect(stats.byOperation['INSERT']).toBeGreaterThanOrEqual(3);
      expect(stats.byTable['memories']).toBeGreaterThanOrEqual(3);
    });
  });
  
  describe('Mock Claude Agent', () => {
    test('should select appropriate tools based on prompt', async () => {
      const mockClaude = new MockClaude(memoryService, logger);
      
      const fileCreationLog = await mockClaude.simulateInteraction(
        'Create a new React component called Button.jsx'
      );
      
      expect(fileCreationLog.toolsSelected).toContainEqual(
        expect.objectContaining({
          name: 'create_file'
        })
      );
      
      const memoryLog = await mockClaude.simulateInteraction(
        'Remember that all API keys should be stored in environment variables'
      );
      
      expect(memoryLog.toolsSelected).toContainEqual(
        expect.objectContaining({
          name: 'mcp__claude-recall__store_memory'
        })
      );
    });
    
    test('should respect compliance level for search behavior', async () => {
      const mockClaude = new MockClaude(memoryService, logger);
      
      // Test with 100% compliance
      mockClaude.setComplianceLevel(1.0);
      let searchCount = 0;
      
      for (let i = 0; i < 10; i++) {
        const log = await mockClaude.simulateInteraction(
          'Create a new file called test.js'
        );
        if (log.toolsSelected.some(t => t.name.includes('search'))) {
          searchCount++;
        }
      }
      
      expect(searchCount).toBeGreaterThanOrEqual(8); // Should search most of the time
      
      // Test with 0% compliance
      mockClaude.setComplianceLevel(0.0);
      searchCount = 0;
      
      for (let i = 0; i < 10; i++) {
        const log = await mockClaude.simulateInteraction(
          'Create a new file called test.js'
        );
        if (log.toolsSelected.some(t => t.name.includes('search'))) {
          searchCount++;
        }
      }
      
      expect(searchCount).toBeLessThanOrEqual(2); // Should rarely search
    });
  });
  
  describe('Scenario Runner', () => {
    test('should execute predefined scenarios', async () => {
      const runner = new ScenarioRunner(memoryService, logger);
      
      const result = await runner.run('memory_persistence');
      
      expect(result).toBeDefined();
      expect(result.name).toBe('memory_persistence');
      expect(result.steps.length).toBeGreaterThan(0);
      expect(result.success).toBeDefined();
    });
    
    test('should validate step expectations', async () => {
      const runner = new ScenarioRunner(memoryService, logger);
      
      const result = await runner.run('context_retrieval');
      
      expect(result).toBeDefined();
      expect(result.name).toBe('context_retrieval');
      
      // Check if memories were stored
      const storeSteps = result.steps.filter(s => s.action === 'store_memory');
      expect(storeSteps.length).toBeGreaterThan(0);
      
      // Check if search was performed
      const searchSteps = result.steps.filter(s => s.action === 'search');
      expect(searchSteps.length).toBeGreaterThan(0);
    });
    
    test('should list all available scenarios', () => {
      const runner = new ScenarioRunner(memoryService, logger);
      
      const scenarios = runner.getScenarios();
      
      expect(scenarios.length).toBeGreaterThan(0);
      expect(scenarios).toContainEqual(
        expect.objectContaining({
          name: 'memory_persistence'
        })
      );
      expect(scenarios).toContainEqual(
        expect.objectContaining({
          name: 'search_compliance'
        })
      );
    });
  });
  
  describe('Auto-Correction Engine', () => {
    test('should analyze test failures and suggest fixes', async () => {
      const engine = new AutoCorrectionEngine(memoryService, logger);
      
      const failedResult = {
        scenario: 'search_compliance',
        status: 'failed' as const,
        observations: {
          memoriesStored: [],
          searchesPerformed: [],
          filesCreated: [{ path: 'test.js' }],
          complianceViolations: [{
            type: 'missing_search',
            message: 'Search not called before file creation'
          }]
        },
        insights: {
          rootCause: 'Memory search not triggered before file operations',
          suggestedFix: 'Add search enforcement hook',
          confidenceLevel: 0.8
        },
        reproduction: {
          steps: ['store_memory', 'create_file'],
          environment: { sessionId: 'test' }
        }
      };
      
      const analysis = await engine.analyzeFailure(failedResult);
      
      expect(analysis).toBeDefined();
      expect(analysis.issueType).toBe('search_compliance');
      expect(analysis.suggestedFixes.length).toBeGreaterThan(0);
    });
    
    test('should generate fixes based on failure analysis', async () => {
      const engine = new AutoCorrectionEngine(memoryService, logger);
      
      const analysis = {
        issueType: 'search_compliance' as const,
        rootCause: 'Search not triggered',
        affectedComponents: ['hooks/memory-search-enforcer.js'],
        suggestedFixes: [{
          file: 'src/hooks/memory-search-enforcer.js',
          suggested: '// Enhanced search enforcement',
          reason: 'Force search before file operations',
          confidence: 0.8
        }]
      };
      
      const fix = await engine.generateFix(analysis);
      
      expect(fix).toBeDefined();
      expect(fix.issueType).toBe('search_compliance');
      expect(fix.files.length).toBeGreaterThan(0);
      expect(fix.confidence).toBeGreaterThan(0);
    });
    
    test('should provide learning insights', () => {
      const engine = new AutoCorrectionEngine(memoryService, logger);
      
      const insights = engine.getLearningInsights();
      
      expect(insights).toBeDefined();
      expect(insights.mostCommonIssues).toBeDefined();
      expect(insights.successRate).toBeGreaterThanOrEqual(0);
      expect(insights.successRate).toBeLessThanOrEqual(1);
      expect(insights.recommendedFixes).toBeDefined();
    });
  });
  
  describe('End-to-End MCP Tool Testing', () => {
    test('should execute test scenario through MCP tool', async () => {
      // This would require actually starting the MCP server and sending requests
      // For now, we'll test the tool handler directly
      
      const testTools = (server as any).tools.get('mcp__test__run_scenario');
      expect(testTools).toBeDefined();
      
      if (testTools) {
        const result = await testTools.handler(
          { scenario: 'memory_persistence' },
          { sessionId: 'e2e_test', timestamp: Date.now() }
        );
        
        expect(result).toBeDefined();
        expect(result.scenario).toBe('memory_persistence');
        expect(result.status).toBeDefined();
      }
    });
    
    test('should simulate Claude behavior through MCP tool', async () => {
      const testTools = (server as any).tools.get('mcp__test__simulate_claude');
      expect(testTools).toBeDefined();
      
      if (testTools) {
        const result = await testTools.handler(
          {
            prompt: 'Create a test file for the authentication module',
            complianceLevel: 0.8
          },
          { sessionId: 'e2e_test_2', timestamp: Date.now() }
        );
        
        expect(result).toBeDefined();
        expect(result.toolsSelected).toBeDefined();
        expect(result.complianceMatched).toBeDefined();
      }
    });
  });
});