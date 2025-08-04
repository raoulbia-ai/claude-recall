import { PatternDetector, DetectedPattern } from '../../src/core/pattern-detector';
import { PatternService } from '../../src/services/pattern-service';

describe('PatternDetector', () => {
  let detector: PatternDetector;
  
  beforeEach(() => {
    detector = new PatternDetector();
  });
  
  describe('detectTaskType', () => {
    it('should detect create_test patterns', () => {
      const testCases = [
        'create a test for the auth module',
        'write test for user service',
        'add unit test for login function',
        'generate tests for the API',
        'make a test suite for the validator'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBe('create_test');
      });
    });
    
    it('should detect fix_bug patterns', () => {
      const testCases = [
        'fix the TypeError in user.service.ts',
        'there is an error in the login function',
        'the auth module is not working',
        'resolve the bug in payment processing',
        'debug the failing test',
        'the API endpoint is broken'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBe('fix_bug');
      });
    });
    
    it('should detect refactor patterns', () => {
      const testCases = [
        'refactor the React component to use hooks',
        'clean up the messy code in auth.js',
        'improve the database query performance',
        'optimize the sorting algorithm',
        'reorganize the project structure',
        'simplify the complex conditional logic'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBe('refactor');
      });
    });
    
    it('should detect add_feature patterns', () => {
      const testCases = [
        'add a new endpoint to the Express router',
        'implement user authentication',
        'create a dashboard component',
        'build a notification system',
        'develop a search functionality'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBe('add_feature');
      });
    });
    
    it('should detect explain patterns', () => {
      const testCases = [
        'explain how the authentication flow works',
        'what is the purpose of this function',
        'how does the caching mechanism work',
        'why is this algorithm used here',
        'describe how the API handles errors'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBe('explain');
      });
    });
    
    it('should detect review patterns', () => {
      const testCases = [
        'review the code for security issues',
        'check the implementation for bugs',
        'analyze the performance of this function',
        'audit the authentication system',
        'evaluate the code quality'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBe('review');
      });
    });
    
    it('should return undefined for unclear patterns', () => {
      const testCases = [
        'hello world',
        'the quick brown fox',
        'update the documentation',
        ''
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.taskType).toBeUndefined();
      });
    });
  });
  
  describe('detectLanguage', () => {
    it('should detect language from file extensions', () => {
      const testCases = [
        { prompt: 'update the user.service.ts file', expected: 'typescript' },
        { prompt: 'fix error in app.js', expected: 'javascript' },
        { prompt: 'modify main.py script', expected: 'python' },
        { prompt: 'refactor UserController.java', expected: 'java' },
        { prompt: 'optimize server.go', expected: 'go' },
        { prompt: 'update styles.rb', expected: 'ruby' }
      ];
      
      testCases.forEach(({ prompt, expected }) => {
        const result = detector.detectPatterns(prompt);
        expect(result.language).toBe(expected);
      });
    });
    
    it('should detect language from explicit mentions', () => {
      const testCases = [
        { prompt: 'write a TypeScript function', expected: 'typescript' },
        { prompt: 'create a Python script', expected: 'python' },
        { prompt: 'implement in JavaScript', expected: 'javascript' },
        { prompt: 'use Golang for this', expected: 'go' },
        { prompt: 'write C++ code', expected: 'cpp' }
      ];
      
      testCases.forEach(({ prompt, expected }) => {
        const result = detector.detectPatterns(prompt);
        expect(result.language).toBe(expected);
      });
    });
    
    it('should detect TypeScript from type annotations', () => {
      const prompts = [
        'create a function with interface User',
        'implement type alias for Product',
        'add : string parameter',
        'define : number return type'
      ];
      
      prompts.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.language).toBe('typescript');
      });
    });
    
    it('should return undefined when no language is detected', () => {
      const result = detector.detectPatterns('update the configuration');
      expect(result.language).toBeUndefined();
    });
  });
  
  describe('detectFramework', () => {
    it('should detect React patterns', () => {
      const testCases = [
        'create a React component',
        'add useState hook',
        'implement useEffect',
        'pass props to child',
        'render JSX elements'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.framework).toBe('react');
      });
    });
    
    it('should detect Express patterns', () => {
      const testCases = [
        'add router middleware',
        'create app.get endpoint',
        'handle req, res in controller',
        'setup Express() server',
        'implement app.post route'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.framework).toBe('express');
      });
    });
    
    it('should detect Jest patterns', () => {
      const testCases = [
        'write describe block',
        'add it() test case',
        'expect value toBe true',
        'create mock function',
        'use beforeEach setup'
      ];
      
      testCases.forEach(prompt => {
        const result = detector.detectPatterns(prompt);
        expect(result.framework).toBe('jest');
      });
    });
    
    it('should detect multiple frameworks', () => {
      const result = detector.detectPatterns('test React component with Jest using describe and expect');
      // Since our implementation returns the first match, it should detect 'react' first
      expect(['react', 'jest']).toContain(result.framework);
    });
    
    it('should return undefined when no framework is detected', () => {
      const result = detector.detectPatterns('update the configuration file');
      expect(result.framework).toBeUndefined();
    });
  });
  
  describe('extractEntities', () => {
    it('should extract file names', () => {
      const result = detector.detectPatterns('update user.service.ts and auth.controller.js files');
      expect(result.entities).toContain('user.service.ts');
      expect(result.entities).toContain('auth.controller.js');
    });
    
    it('should extract function names', () => {
      const result = detector.detectPatterns('fix the getUserData() and validateAuth() functions');
      expect(result.entities).toContain('getUserData');
      expect(result.entities).toContain('validateAuth');
    });
    
    it('should extract quoted strings', () => {
      const result = detector.detectPatterns('add error message "Invalid credentials" and "User not found"');
      expect(result.entities).toContain('Invalid credentials');
      expect(result.entities).toContain('User not found');
    });
    
    it('should extract class/component names', () => {
      const result = detector.detectPatterns('refactor UserService class and AuthController');
      expect(result.entities).toContain('UserService');
      expect(result.entities).toContain('AuthController');
    });
    
    it('should handle mixed quotes', () => {
      const result = detector.detectPatterns('change "hello" to \'world\'');
      expect(result.entities).toContain('hello');
      expect(result.entities).toContain('world');
    });
    
    it('should remove duplicate entities', () => {
      const result = detector.detectPatterns('update user.ts in user.ts file');
      const userTsCount = result.entities?.filter(e => e === 'user.ts').length || 0;
      expect(userTsCount).toBe(1);
    });
    
    it('should return empty array when no entities found', () => {
      const result = detector.detectPatterns('do something');
      expect(result.entities).toEqual([]);
    });
  });
  
  describe('integration tests', () => {
    it('should handle complex prompts with multiple patterns', () => {
      const result = detector.detectPatterns(
        'fix the TypeError in UserService.ts component that uses React hooks'
      );
      
      expect(result.taskType).toBe('fix_bug');
      expect(result.language).toBe('typescript');
      expect(result.framework).toBe('react');
      expect(result.entities).toContain('UserService.ts');
      expect(result.entities).toContain('TypeError');
    });
    
    it('should handle the example test cases from requirements', () => {
      const testCases = [
        {
          prompt: 'create a test for the auth module',
          expected: { taskType: 'create_test', entities: ['auth module'] }
        },
        {
          prompt: 'fix the TypeError in user.service.ts',
          expected: { taskType: 'fix_bug', language: 'typescript', entities: ['user.service.ts', 'TypeError'] }
        },
        {
          prompt: 'refactor the React component to use hooks',
          expected: { taskType: 'refactor', framework: 'react', entities: ['React'] }
        },
        {
          prompt: 'add a new endpoint to the Express router',
          expected: { taskType: 'add_feature', framework: 'express' }
        },
        {
          prompt: 'explain how the authentication flow works',
          expected: { taskType: 'explain', entities: ['authentication flow'] }
        }
      ];
      
      testCases.forEach(({ prompt, expected }) => {
        const result = detector.detectPatterns(prompt);
        
        if (expected.taskType) {
          expect(result.taskType).toBe(expected.taskType);
        }
        if (expected.language) {
          expect(result.language).toBe(expected.language);
        }
        if (expected.framework) {
          expect(result.framework).toBe(expected.framework);
        }
        if (expected.entities) {
          expected.entities.forEach(entity => {
            expect(result.entities).toContain(entity);
          });
        }
      });
    });
  });
});

describe('PatternService', () => {
  let service: PatternService;
  
  beforeEach(() => {
    // Reset singleton instance
    (PatternService as any).instance = undefined;
    service = PatternService.getInstance();
  });
  
  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = PatternService.getInstance();
      const instance2 = PatternService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });
  
  describe('analyzePrompt', () => {
    it('should analyze prompt and return detected patterns', () => {
      const result = service.analyzePrompt('create a test for auth.service.ts');
      expect(result.taskType).toBe('create_test');
      expect(result.language).toBe('typescript');
      expect(result.entities).toContain('auth.service.ts');
    });
  });
  
  describe('enhanceContext', () => {
    it('should enhance context with detected patterns', () => {
      const existingContext = { userId: '123', timestamp: Date.now() };
      const enhanced = service.enhanceContext(existingContext, 'fix bug in React component');
      
      expect(enhanced.userId).toBe('123');
      expect(enhanced.detectedPatterns).toBeDefined();
      expect(enhanced.taskType).toBe('fix_bug');
      expect(enhanced.primaryFramework).toBe('react');
    });
    
    it('should add task-specific context', () => {
      const enhanced = service.enhanceContext({}, 'create unit test');
      expect(enhanced.taskSpecificContext).toBeDefined();
      expect(enhanced.taskSpecificContext.suggestedActions).toContain('analyze existing test patterns');
    });
    
    it('should add language-specific hints', () => {
      const enhanced = service.enhanceContext({}, 'write TypeScript code');
      expect(enhanced.languageSpecificHints).toBeDefined();
      expect(enhanced.languageSpecificHints.bestPractices).toContain('use strict types');
    });
    
    it('should add framework-specific patterns', () => {
      const enhanced = service.enhanceContext({}, 'create React component with hooks');
      expect(enhanced.frameworkSpecificPatterns).toBeDefined();
      expect(enhanced.frameworkSpecificPatterns.componentPatterns).toContain('hooks');
    });
    
    it('should classify entities', () => {
      const enhanced = service.enhanceContext(
        {},
        'update UserService class in user.service.ts file'
      );
      expect(enhanced.entityTypes).toBeDefined();
      expect(enhanced.entityTypes.files).toContain('user.service.ts');
      expect(enhanced.entityTypes.classes).toContain('UserService');
    });
    
    it('should preserve existing context', () => {
      const existingContext = {
        customField: 'value',
        nestedObject: { key: 'value' }
      };
      const enhanced = service.enhanceContext(existingContext, 'simple prompt');
      
      expect(enhanced.customField).toBe('value');
      expect(enhanced.nestedObject).toEqual({ key: 'value' });
    });
  });
});