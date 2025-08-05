import { MemoryEnhancer } from '../../src/services/memory-enhancer';
import { MemoryService } from '../../src/services/memory';
import { PatternService } from '../../src/services/pattern-service';
import { MemoryStorage } from '../../src/memory/storage';
import { ConfigService } from '../../src/services/config';
import * as fs from 'fs';
import * as path from 'path';

describe('Intelligent Retrieval Integration Tests', () => {
  let memoryEnhancer: MemoryEnhancer;
  let memoryService: MemoryService;
  let testDbPath: string;
  
  beforeAll(() => {
    // Clear any existing singleton instance
    (MemoryService as any).instance = null;
    
    // Setup test database
    testDbPath = path.join(__dirname, '../fixtures/test-intelligent-retrieval.db');
    
    // Create fixtures directory if it doesn't exist
    const fixturesDir = path.dirname(testDbPath);
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    
    // Remove existing test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    
    // Mock config to use test database
    jest.spyOn(ConfigService.prototype, 'getDatabasePath').mockReturnValue(testDbPath);
    jest.spyOn(ConfigService.prototype, 'getProjectId').mockReturnValue('test-project');
    
    // Initialize services
    memoryService = MemoryService.getInstance();
    memoryEnhancer = new MemoryEnhancer();
    
    // Populate test data
    setupTestData();
  });
  
  afterAll(() => {
    // Cleanup
    if (memoryService) {
      memoryService.close();
    }
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
    jest.restoreAllMocks();
  });
  
  function setupTestData() {
    // Add test directory preference
    memoryService.storePreference({
      pattern: 'test directory',
      value: 'tests/',
      description: 'Tests should be saved in tests/ directory'
    }, {
      projectId: 'test-project',
      timestamp: Date.now()
    });
    
    // Add error history
    memoryService.store({
      key: 'error_fix_typeof',
      value: {
        error: 'TypeError: Cannot read property of undefined',
        file: 'auth.js',
        fix: 'Added null check before accessing property',
        line: 42
      },
      type: 'project-knowledge',
      context: {
        projectId: 'test-project',
        filePath: 'auth.js'
      }
    });
    
    // Add code style preferences
    memoryService.storePreference({
      pattern: 'arrow functions',
      value: 'prefer arrow functions for callbacks',
      examples: ['setTimeout(() => {}, 100)', 'array.map(x => x * 2)']
    }, {
      projectId: 'test-project'
    });
    
    memoryService.storePreference({
      pattern: 'async/await',
      value: 'use async/await instead of promises',
      examples: ['async function fetchData() { await api.get() }']
    }, {
      projectId: 'test-project'
    });
    
    // Add API conventions
    memoryService.store({
      key: 'api_conventions',
      value: {
        pattern: 'RESTful API',
        baseUrl: '/api/v1',
        conventions: {
          endpoints: 'plural nouns (e.g., /users, /products)',
          methods: 'GET, POST, PUT, DELETE',
          responses: 'JSON with consistent structure'
        }
      },
      type: 'project-knowledge',
      context: {
        projectId: 'test-project'
      }
    });
  }
  
  describe('Real-world scenarios', () => {
    test('Scenario 1: User says "create a test for auth" → System retrieves test directory preference', async () => {
      const prompt = 'create a test for the user service';
      const results = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should find the test directory preference
      const testDirMemory = results.find(m => 
        m.value && 
        typeof m.value === 'object' && 
        (m.value.value?.includes('tests/') || 
         m.value.description?.includes('tests/'))
      );
      
      expect(testDirMemory).toBeDefined();
      expect(testDirMemory?.type).toBe('preference');
      expect(JSON.stringify(testDirMemory?.value)).toContain('tests/');
    });
    
    test('Scenario 2: User says "fix TypeError" → System retrieves previous TypeError fixes', async () => {
      const prompt = 'fix the undefined error in auth.js';
      const results = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should find the previous TypeError fix
      const errorFixMemory = results.find(m => 
        m.key === 'error_fix_typeof' ||
        (m.value && JSON.stringify(m.value).includes('TypeError'))
      );
      
      expect(errorFixMemory).toBeDefined();
      expect(errorFixMemory?.type).toBe('project-knowledge');
      expect(errorFixMemory?.value).toHaveProperty('fix');
    });
    
    test('Scenario 3: User says "refactor to use async" → System retrieves async/await preferences', async () => {
      const prompt = 'refactor this function to use modern syntax';
      const results = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should find async/await and arrow function preferences
      const asyncPref = results.find(m => 
        m.value && 
        JSON.stringify(m.value).includes('async/await')
      );
      
      const arrowPref = results.find(m => 
        m.value && 
        JSON.stringify(m.value).includes('arrow functions')
      );
      
      expect(asyncPref).toBeDefined();
      expect(arrowPref).toBeDefined();
      expect(asyncPref?.type).toBe('preference');
      expect(arrowPref?.type).toBe('preference');
    });
    
    test('Scenario 4: User says "add user endpoint" → System retrieves API conventions', async () => {
      const prompt = 'add a new API endpoint for products';
      const results = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should find API conventions
      const apiMemory = results.find(m => 
        m.key === 'api_conventions' ||
        (m.value && JSON.stringify(m.value).includes('RESTful'))
      );
      
      expect(apiMemory).toBeDefined();
      expect(apiMemory?.type).toBe('project-knowledge');
      expect(apiMemory?.value).toHaveProperty('baseUrl');
      expect(apiMemory?.value).toHaveProperty('conventions');
    });
  });
  
  describe('Pattern detection integration', () => {
    test('should correctly identify test creation tasks without explicit "directory" mention', async () => {
      const prompts = [
        'create a test for auth module',
        'write tests for user service',
        'add unit test for login function',
        'make a test case for registration'
      ];
      
      for (const prompt of prompts) {
        const results = await memoryEnhancer.enhanceSearch(prompt);
        
        // Each should retrieve test directory preference
        const hasTestDirPref = results.some(m => 
          JSON.stringify(m.value).includes('tests/')
        );
        
        expect(hasTestDirPref).toBe(true);
      }
    });
    
    test('should identify bug fix patterns and retrieve relevant fixes', async () => {
      // Test specific error types that we have data for
      const errorPrompt = 'fix TypeError in authentication';
      const results = await memoryEnhancer.enhanceSearch(errorPrompt);
      
      // Should find the TypeError fix we stored
      const hasTypeErrorFix = results.some(m => 
        m.key === 'error_fix_typeof' ||
        (m.value && JSON.stringify(m.value).includes('TypeError'))
      );
      
      expect(hasTypeErrorFix).toBe(true);
      
      // Test general bug fix patterns
      const bugPrompts = [
        'fix undefined error in auth.js',
        'resolve error in auth.js'
      ];
      
      for (const prompt of bugPrompts) {
        const bugResults = await memoryEnhancer.enhanceSearch(prompt);
        
        // Should find some relevant memory (either the TypeError fix or preferences)
        const hasRelevantMemory = bugResults.length > 0 && bugResults.some(m => 
          m.type === 'project-knowledge' || 
          m.type === 'preference' ||
          (m.value && JSON.stringify(m.value).toLowerCase().includes('error'))
        );
        
        expect(hasRelevantMemory).toBe(true);
      }
    });
  });
  
  describe('Performance requirements', () => {
    test('should complete all searches within 100ms', async () => {
      const prompts = [
        'create a test for user authentication service',
        'fix TypeError: Cannot read property length of undefined in utils.js',
        'refactor dashboard component to use hooks instead of class',
        'add REST API endpoint for product inventory management'
      ];
      
      for (const prompt of prompts) {
        const startTime = Date.now();
        await memoryEnhancer.enhanceSearch(prompt);
        const endTime = Date.now();
        
        expect(endTime - startTime).toBeLessThan(100);
      }
    });
    
    test('should handle large result sets efficiently', async () => {
      // Add many memories
      for (let i = 0; i < 100; i++) {
        memoryService.store({
          key: `bulk_test_${i}`,
          value: { data: `test data ${i}` },
          type: 'project-knowledge',
          context: { projectId: 'test-project' }
        });
      }
      
      const startTime = Date.now();
      const results = await memoryEnhancer.enhanceSearch('search for test data');
      const endTime = Date.now();
      
      expect(endTime - startTime).toBeLessThan(100);
      expect(results.length).toBeLessThanOrEqual(10); // Should limit results
    });
  });
  
  describe('Backwards compatibility', () => {
    test('should work when pattern detection returns empty results', async () => {
      const prompt = 'random query without patterns';
      const results = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should still work and return any direct matches
      expect(Array.isArray(results)).toBe(true);
    });
    
    test('should preserve existing direct search functionality', async () => {
      // Store a memory that should be found by direct search
      memoryService.store({
        key: 'direct_match_test',
        value: 'specific test value for direct matching',
        type: 'project-knowledge',
        context: { projectId: 'test-project' }
      });
      
      const prompt = 'specific test value for direct matching';
      const results = await memoryEnhancer.enhanceSearch(prompt);
      
      // Should find the direct match
      const directMatch = results.find(m => m.key === 'direct_match_test');
      expect(directMatch).toBeDefined();
    });
  });
});