import { PatternDetector, DetectedPattern } from '../core/pattern-detector';

interface Context {
  [key: string]: any;
}

export class PatternService {
  private static instance: PatternService;
  private detector: PatternDetector;

  private constructor() {
    this.detector = new PatternDetector();
  }

  static getInstance(): PatternService {
    if (!PatternService.instance) {
      PatternService.instance = new PatternService();
    }
    return PatternService.instance;
  }

  analyzePrompt(prompt: string): DetectedPattern {
    return this.detector.detectPatterns(prompt);
  }

  enhanceContext(existingContext: Context, prompt: string): Context {
    const detectedPatterns = this.analyzePrompt(prompt);
    
    const enhancedContext: Context = {
      ...existingContext,
      detectedPatterns: detectedPatterns
    };

    // Add specific context enhancements based on detected patterns
    if (detectedPatterns.taskType) {
      enhancedContext.taskType = detectedPatterns.taskType;
      enhancedContext.taskSpecificContext = this.getTaskSpecificContext(detectedPatterns.taskType);
    }

    if (detectedPatterns.language) {
      enhancedContext.primaryLanguage = detectedPatterns.language;
      enhancedContext.languageSpecificHints = this.getLanguageHints(detectedPatterns.language);
    }

    if (detectedPatterns.framework) {
      enhancedContext.primaryFramework = detectedPatterns.framework;
      enhancedContext.frameworkSpecificPatterns = this.getFrameworkPatterns(detectedPatterns.framework);
    }

    if (detectedPatterns.entities && detectedPatterns.entities.length > 0) {
      enhancedContext.mentionedEntities = detectedPatterns.entities;
      enhancedContext.entityTypes = this.classifyEntities(detectedPatterns.entities);
    }

    return enhancedContext;
  }

  private getTaskSpecificContext(taskType: string): any {
    const taskContexts: { [key: string]: any } = {
      'create_test': {
        suggestedActions: ['analyze existing test patterns', 'identify test framework', 'determine test scope'],
        commonPatterns: ['arrange-act-assert', 'given-when-then', 'setup-teardown'],
        relatedFiles: ['*.test.*', '*.spec.*', '__tests__/*']
      },
      'fix_bug': {
        suggestedActions: ['reproduce issue', 'identify root cause', 'verify fix'],
        debuggingHints: ['check error logs', 'review recent changes', 'validate inputs'],
        relatedConcepts: ['error handling', 'edge cases', 'regression testing']
      },
      'refactor': {
        suggestedActions: ['identify code smells', 'maintain behavior', 'improve readability'],
        refactoringPatterns: ['extract method', 'rename variable', 'simplify conditional'],
        qualityMetrics: ['cyclomatic complexity', 'code duplication', 'coupling']
      },
      'add_feature': {
        suggestedActions: ['understand requirements', 'design architecture', 'implement incrementally'],
        designConsiderations: ['scalability', 'maintainability', 'testability'],
        integrationPoints: ['API endpoints', 'database schema', 'UI components']
      },
      'explain': {
        suggestedActions: ['provide overview', 'explain details', 'give examples'],
        explanationStructure: ['what', 'why', 'how', 'when'],
        visualAids: ['diagrams', 'code snippets', 'flow charts']
      },
      'review': {
        suggestedActions: ['check correctness', 'assess quality', 'suggest improvements'],
        reviewChecklist: ['functionality', 'performance', 'security', 'maintainability'],
        commonIssues: ['code style', 'error handling', 'documentation']
      }
    };

    return taskContexts[taskType] || {};
  }

  private getLanguageHints(language: string): any {
    const languageHints: { [key: string]: any } = {
      'typescript': {
        bestPractices: ['use strict types', 'avoid any', 'prefer interfaces'],
        commonTools: ['tsc', 'ts-node', 'eslint'],
        fileExtensions: ['.ts', '.tsx', '.d.ts']
      },
      'javascript': {
        bestPractices: ['use const/let', 'avoid var', 'use arrow functions'],
        commonTools: ['node', 'npm', 'eslint'],
        fileExtensions: ['.js', '.jsx', '.mjs']
      },
      'python': {
        bestPractices: ['follow PEP 8', 'use type hints', 'virtual environments'],
        commonTools: ['pip', 'pytest', 'black'],
        fileExtensions: ['.py', '.pyw', '.pyi']
      },
      'java': {
        bestPractices: ['follow naming conventions', 'use generics', 'proper exception handling'],
        commonTools: ['maven', 'gradle', 'junit'],
        fileExtensions: ['.java', '.jar', '.class']
      },
      'go': {
        bestPractices: ['handle errors explicitly', 'use goroutines wisely', 'keep it simple'],
        commonTools: ['go mod', 'go test', 'golint'],
        fileExtensions: ['.go', '.mod']
      }
    };

    return languageHints[language] || {};
  }

  private getFrameworkPatterns(framework: string): any {
    const frameworkPatterns: { [key: string]: any } = {
      'react': {
        componentPatterns: ['functional components', 'hooks', 'context'],
        stateManagement: ['useState', 'useReducer', 'Redux', 'Context API'],
        commonLibraries: ['react-router', 'axios', 'styled-components']
      },
      'express': {
        architecturePatterns: ['MVC', 'REST API', 'middleware chain'],
        commonMiddleware: ['body-parser', 'cors', 'helmet', 'morgan'],
        routingPatterns: ['route parameters', 'query strings', 'route handlers']
      },
      'jest': {
        testPatterns: ['unit tests', 'integration tests', 'mocking'],
        matchers: ['toBe', 'toEqual', 'toHaveBeenCalled'],
        setupFiles: ['jest.config.js', 'setupTests.js']
      },
      'vue': {
        componentPatterns: ['single file components', 'composition API', 'options API'],
        stateManagement: ['Vuex', 'Pinia', 'reactive', 'ref'],
        directives: ['v-if', 'v-for', 'v-model', 'v-show']
      },
      'django': {
        architecturePatterns: ['MVT', 'apps structure', 'ORM'],
        commonApps: ['auth', 'admin', 'contenttypes'],
        urlPatterns: ['path', 'include', 'namespace']
      }
    };

    return frameworkPatterns[framework] || {};
  }

  private classifyEntities(entities: string[]): { [key: string]: string[] } {
    const classified: { [key: string]: string[] } = {
      files: [],
      functions: [],
      classes: [],
      strings: [],
      other: []
    };

    for (const entity of entities) {
      if (entity.includes('.') && /\.\w+$/.test(entity)) {
        classified.files.push(entity);
      } else if (/^[a-z][a-zA-Z0-9_]*$/.test(entity)) {
        classified.functions.push(entity);
      } else if (/^[A-Z][a-zA-Z0-9]+$/.test(entity)) {
        classified.classes.push(entity);
      } else if (entity.includes(' ') || /[^a-zA-Z0-9._-]/.test(entity)) {
        classified.strings.push(entity);
      } else {
        classified.other.push(entity);
      }
    }

    // Remove empty categories
    Object.keys(classified).forEach(key => {
      if (classified[key].length === 0) {
        delete classified[key];
      }
    });

    return classified;
  }
}