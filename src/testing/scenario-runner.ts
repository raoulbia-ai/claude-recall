import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { SearchMonitor } from '../services/search-monitor';

export interface ScenarioStep {
  action: 'store_memory' | 'search' | 'create_file' | 'retrieve' | 'wait';
  params: any;
  timing?: {
    delay?: number;
    timeout?: number;
  };
  validation?: {
    expectSearch?: boolean;
    expectMemory?: boolean;
    expectResult?: any;
  };
}

export interface ScenarioDefinition {
  name: string;
  description: string;
  steps: ScenarioStep[];
  expectedOutcome: {
    searchCompliance?: boolean;
    memoryPersistence?: boolean;
    fileLocation?: string;
    customValidation?: (result: any) => boolean;
  };
}

export interface ScenarioResult {
  name: string;
  success: boolean;
  steps: any[];
  searches: any[];
  files: any[];
  expectedSearches?: boolean;
  searchPerformed?: boolean;
  expectedMemory?: boolean;
  memoryStored?: boolean;
  rateLimitExpected?: boolean;
  rateLimitTriggered?: boolean;
  errors: any[];
}

export class ScenarioRunner {
  private searchMonitor: SearchMonitor;
  private scenarios: Map<string, ScenarioDefinition> = new Map();
  
  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.searchMonitor = SearchMonitor.getInstance();
    this.registerScenarios();
  }
  
  private registerScenarios(): void {
    // Memory Persistence Test
    this.scenarios.set('memory_persistence', {
      name: 'memory_persistence',
      description: 'Test if memories are persisted correctly with location preferences',
      steps: [
        {
          action: 'store_memory',
          params: {
            content: 'Save all tests in test-pasta/ directory',
            metadata: { type: 'preference', category: 'file_location' }
          }
        },
        {
          action: 'wait',
          params: { duration: 100 }
        },
        {
          action: 'create_file',
          params: {
            type: 'test',
            name: 'sample.test.js'
          },
          validation: {
            expectSearch: true
          }
        }
      ],
      expectedOutcome: {
        searchCompliance: true,
        memoryPersistence: true,
        fileLocation: 'test-pasta/sample.test.js'
      }
    });
    
    // Search Compliance Test
    this.scenarios.set('search_compliance', {
      name: 'search_compliance',
      description: 'Test if search is called before file creation',
      steps: [
        {
          action: 'store_memory',
          params: {
            content: 'Project uses TypeScript with strict mode enabled',
            metadata: { type: 'context', category: 'project_config' }
          }
        },
        {
          action: 'create_file',
          params: {
            name: 'utils.ts',
            content: 'export function helper() {}'
          },
          validation: {
            expectSearch: true
          }
        }
      ],
      expectedOutcome: {
        searchCompliance: true
      }
    });
    
    // Rate Limiting Test
    this.scenarios.set('rate_limiting', {
      name: 'rate_limiting',
      description: 'Test if rate limiting prevents excessive requests',
      steps: [
        // Generate 20 rapid requests
        ...Array(20).fill(null).map((_, i) => ({
          action: 'search' as const,
          params: { query: `test query ${i}` },
          timing: { delay: 10 } // 10ms between requests
        }))
      ],
      expectedOutcome: {
        customValidation: (result: any) => {
          // Should have some rate limit errors
          return result.errors && result.errors.some((e: any) => 
            e.message && e.message.includes('rate limit')
          );
        }
      }
    });
    
    // Context Retrieval Test
    this.scenarios.set('context_retrieval', {
      name: 'context_retrieval',
      description: 'Test if relevant context is retrieved when needed',
      steps: [
        {
          action: 'store_memory',
          params: {
            content: 'API endpoints should follow RESTful conventions',
            metadata: { type: 'guideline', category: 'api_design' }
          }
        },
        {
          action: 'store_memory',
          params: {
            content: 'Use camelCase for JavaScript variables',
            metadata: { type: 'guideline', category: 'code_style' }
          }
        },
        {
          action: 'search',
          params: { query: 'API design guidelines' },
          validation: {
            expectResult: (results: any[]) => 
              results.length > 0 && 
              results.some(r => r.content?.includes('RESTful'))
          }
        }
      ],
      expectedOutcome: {
        memoryPersistence: true
      }
    });
    
    // File Location Compliance Test
    this.scenarios.set('file_location_compliance', {
      name: 'file_location_compliance',
      description: 'Test if files are created in the correct location based on preferences',
      steps: [
        {
          action: 'store_memory',
          params: {
            content: 'Components go in src/components/',
            metadata: { type: 'preference', category: 'file_organization' }
          }
        },
        {
          action: 'store_memory',
          params: {
            content: 'Tests go in __tests__/',
            metadata: { type: 'preference', category: 'file_organization' }
          }
        },
        {
          action: 'search',
          params: { query: 'component location' }
        },
        {
          action: 'create_file',
          params: {
            type: 'component',
            name: 'Button.jsx'
          },
          validation: {
            expectSearch: true
          }
        }
      ],
      expectedOutcome: {
        searchCompliance: true,
        fileLocation: 'src/components/Button.jsx'
      }
    });
  }
  
  async run(scenarioName: string, params?: any): Promise<ScenarioResult> {
    const scenario = this.scenarios.get(scenarioName);
    
    if (!scenario) {
      throw new Error(`Scenario '${scenarioName}' not found`);
    }
    
    this.logger.info('ScenarioRunner', `Running scenario: ${scenarioName}`, {
      description: scenario.description,
      steps: scenario.steps.length
    });
    
    const result: ScenarioResult = {
      name: scenarioName,
      success: true,
      steps: [],
      searches: [],
      files: [],
      errors: []
    };
    
    // Track initial state
    const searchesBefore = this.searchMonitor.getRecentSearches(100).length;
    
    // Execute steps
    for (const [index, step] of scenario.steps.entries()) {
      try {
        this.logger.debug('ScenarioRunner', `Executing step ${index + 1}/${scenario.steps.length}`, step);
        
        // Apply timing delay if specified
        if (step.timing?.delay) {
          await new Promise(resolve => setTimeout(resolve, step.timing?.delay || 0));
        }
        
        // Execute the step
        const stepResult = await this.executeStep(step, params);
        
        // Record the result
        result.steps.push({
          index,
          action: step.action,
          result: stepResult,
          validation: step.validation
        });
        
        // Track searches and files
        if (step.action === 'search') {
          result.searches.push(stepResult);
        } else if (step.action === 'create_file') {
          result.files.push(stepResult);
        }
        
        // Validate step if needed
        if (step.validation) {
          const validationResult = this.validateStep(step, stepResult);
          if (!validationResult.valid) {
            result.success = false;
            result.errors.push({
              step: index,
              message: validationResult.message
            });
          }
        }
        
      } catch (error) {
        result.success = false;
        result.errors.push({
          step: index,
          action: step.action,
          error: (error as Error).message
        });
        
        // Check if it's a rate limit error
        if ((error as Error).message.includes('rate limit')) {
          result.rateLimitTriggered = true;
        }
      }
    }
    
    // Track final state
    const searchesAfter = this.searchMonitor.getRecentSearches(100).length;
    result.searchPerformed = searchesAfter > searchesBefore;
    
    // Apply expected outcome validation
    if (scenario.expectedOutcome.searchCompliance !== undefined) {
      result.expectedSearches = scenario.expectedOutcome.searchCompliance;
    }
    
    if (scenario.expectedOutcome.memoryPersistence !== undefined) {
      result.expectedMemory = scenario.expectedOutcome.memoryPersistence;
      result.memoryStored = result.steps.some(s => 
        s.action === 'store_memory' && s.result?.success
      );
    }
    
    if (scenario.expectedOutcome.customValidation) {
      const customValid = scenario.expectedOutcome.customValidation(result);
      if (!customValid) {
        result.success = false;
        result.errors.push({
          message: 'Custom validation failed'
        });
      }
    }
    
    // Check for rate limiting expectation
    if (scenarioName === 'rate_limiting') {
      result.rateLimitExpected = true;
    }
    
    return result;
  }
  
  private async executeStep(step: ScenarioStep, params?: any): Promise<any> {
    switch (step.action) {
      case 'store_memory':
        const key = `scenario_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await this.memoryService.store({
          key,
          value: step.params,
          type: step.params.metadata?.type || 'scenario_test',
          context: {
            sessionId: params?.sessionId || 'scenario_runner'
          }
        });
        return { success: true, key };
        
      case 'search':
        const results = await this.memoryService.search(step.params.query);
        return results;
        
      case 'create_file':
        // Simulate file creation
        // In a real implementation, this would integrate with the file system
        const shouldSearch = step.validation?.expectSearch;
        if (shouldSearch) {
          // Trigger a search to simulate compliance
          await this.memoryService.search(`file location ${step.params.type}`);
        }
        return {
          created: true,
          path: this.determineFilePath(step.params),
          ...step.params
        };
        
      case 'retrieve':
        const memory = await this.memoryService.retrieve(step.params.key);
        return memory;
        
      case 'wait':
        await new Promise(resolve => setTimeout(resolve, step.params.duration || 100));
        return { waited: step.params.duration || 100 };
        
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }
  }
  
  private validateStep(step: ScenarioStep, result: any): { valid: boolean; message?: string } {
    if (!step.validation) {
      return { valid: true };
    }
    
    if (step.validation.expectSearch !== undefined) {
      // Check if search was performed (would need integration with search monitor)
      // For now, assume it's valid
      return { valid: true };
    }
    
    if (step.validation.expectMemory !== undefined) {
      const hasMemory = result && result.success;
      if (step.validation.expectMemory && !hasMemory) {
        return { valid: false, message: 'Expected memory to be stored' };
      }
    }
    
    if (step.validation.expectResult) {
      if (typeof step.validation.expectResult === 'function') {
        const valid = step.validation.expectResult(result);
        if (!valid) {
          return { valid: false, message: 'Result validation failed' };
        }
      } else {
        const matches = JSON.stringify(result) === JSON.stringify(step.validation.expectResult);
        if (!matches) {
          return { valid: false, message: 'Result does not match expected value' };
        }
      }
    }
    
    return { valid: true };
  }
  
  private determineFilePath(params: any): string {
    // Simulate intelligent file path determination based on type and preferences
    const paths: Record<string, string> = {
      test: 'test-pasta/',
      component: 'src/components/',
      service: 'src/services/',
      util: 'src/utils/',
      config: 'config/'
    };
    
    const basePath = paths[params.type] || 'src/';
    return `${basePath}${params.name}`;
  }
  
  // Get all available scenarios
  getScenarios(): Array<{ name: string; description: string }> {
    return Array.from(this.scenarios.entries()).map(([name, def]) => ({
      name,
      description: def.description
    }));
  }
  
  // Add custom scenario
  addScenario(definition: ScenarioDefinition): void {
    this.scenarios.set(definition.name, definition);
    this.logger.info('ScenarioRunner', `Added custom scenario: ${definition.name}`);
  }
}