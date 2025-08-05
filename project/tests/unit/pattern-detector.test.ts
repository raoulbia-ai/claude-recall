import { PatternDetector, DetectedPattern } from '../../src/core/pattern-detector';
import { PatternService } from '../../src/services/pattern-service';

describe('PatternDetector', () => {
  let detector: PatternDetector;
  
  beforeEach(() => {
    detector = new PatternDetector();
  });
  
  describe('Task Type Detection', () => {
    // Consolidate all task type tests into one parameterized test
    const taskTypeTestCases = [
      { prompt: 'create a test for the auth module', expected: 'create_test' },
      { prompt: 'fix the TypeError in user.service.ts', expected: 'fix_bug' },
      { prompt: 'refactor the React component to use hooks', expected: 'refactor' },
      { prompt: 'add user authentication feature', expected: 'add_feature' },
      { prompt: 'explain how the auth flow works', expected: 'explain' },
      { prompt: 'review the pull request for security issues', expected: 'review' }
    ];

    taskTypeTestCases.forEach(({ prompt, expected }) => {
      it(`should detect ${expected} task type`, () => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBe(expected);
      });
    });
  });
  
  describe('Entity Extraction', () => {
    it('should extract file paths and function names', () => {
      const prompt = 'fix the error in auth.service.ts in the login() function';
      const result = detector.detectPatterns(prompt);
      
      expect(result.entities).toBeDefined();
      expect(result.entities).toContain('auth.service.ts');
      expect(result.entities).toContain('login');
    });
  });
  
  describe('Language and Framework Detection', () => {
    it('should detect programming language from file extensions', () => {
      const cases = [
        { prompt: 'create tests for user.service.ts', lang: 'typescript' },
        { prompt: 'fix bug in auth.py', lang: 'python' },
        { prompt: 'refactor App.js component', lang: 'javascript' }
      ];
      
      cases.forEach(({ prompt, lang }) => {
        const result = detector.detectPatterns(prompt);
        expect(result.language).toBe(lang);
      });
    });
    
    it('should detect frameworks from content', () => {
      const cases = [
        { prompt: 'create a React component with hooks', framework: 'react' },
        { prompt: 'fix the Vue.js computed property', framework: 'vue' },
        { prompt: 'add Express middleware for auth', framework: 'express' }
      ];
      
      cases.forEach(({ prompt, framework }) => {
        const result = detector.detectPatterns(prompt);
        expect(result.framework).toBe(framework);
      });
    });
  });
  
});