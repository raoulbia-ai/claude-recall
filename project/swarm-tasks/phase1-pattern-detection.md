# Swarm Task: Phase 1 - Pattern Detection Module

## Task Description
Implement a PatternDetector module that analyzes user prompts to detect task types and context. This module must be completely new and NOT modify any existing files in the claude-recall system.

## Requirements

### 1. Create Pattern Detection Module
Create a new file `src/core/pattern-detector.ts` with the following capabilities:

```typescript
export interface DetectedPattern {
  taskType?: string;      // 'create_test', 'fix_bug', 'refactor', 'add_feature', etc.
  language?: string;      // 'typescript', 'python', 'javascript', etc.
  framework?: string;     // 'react', 'express', 'jest', etc.
  entities?: string[];    // Key entities mentioned (file names, function names, etc.)
}

export class PatternDetector {
  detectPatterns(prompt: string): DetectedPattern;
  private detectTaskType(prompt: string): string | undefined;
  private detectLanguage(prompt: string): string | undefined;
  private detectFramework(prompt: string): string | undefined;
  private extractEntities(prompt: string): string[];
}
```

### 2. Pattern Rules to Implement

#### Task Type Detection
- `create_test`: matches "create test", "write test", "add test", "test for", "unit test"
- `fix_bug`: matches "fix", "error", "bug", "issue", "problem", "not working"
- `refactor`: matches "refactor", "clean up", "improve", "optimize", "reorganize"
- `add_feature`: matches "add", "implement", "create", "build" (when not test-related)
- `explain`: matches "explain", "what is", "how does", "why"
- `review`: matches "review", "check", "analyze", "audit"

#### Language Detection
- Look for file extensions: `.ts`, `.js`, `.py`, `.java`, `.go`, etc.
- Look for language names: "typescript", "python", "javascript", etc.
- Look for language-specific keywords: "async/await", "def", "import from", etc.

#### Framework Detection
- React: "component", "jsx", "useState", "props"
- Express: "router", "middleware", "app.get", "req, res"
- Jest: "describe", "it", "expect", "mock"
- Vue: "v-if", "computed", "mounted"
- Django: "models", "views", "urls.py"

### 3. Integration Point
Create a new file `src/services/pattern-service.ts` that wraps the PatternDetector:

```typescript
export class PatternService {
  private static instance: PatternService;
  private detector: PatternDetector;
  
  static getInstance(): PatternService;
  
  analyzePrompt(prompt: string): DetectedPattern;
  
  // Method to enhance context with detected patterns
  enhanceContext(existingContext: Context, prompt: string): Context;
}
```

### 4. Test Suite
Create comprehensive tests in `tests/unit/pattern-detector.test.ts`:

```typescript
describe('PatternDetector', () => {
  describe('detectTaskType', () => {
    it('should detect create_test patterns');
    it('should detect fix_bug patterns');
    it('should detect refactor patterns');
    it('should return undefined for unclear patterns');
  });
  
  describe('detectLanguage', () => {
    it('should detect language from file extensions');
    it('should detect language from explicit mentions');
    it('should detect TypeScript from type annotations');
  });
  
  describe('detectFramework', () => {
    it('should detect React patterns');
    it('should detect Express patterns');
    it('should detect multiple frameworks');
  });
  
  describe('extractEntities', () => {
    it('should extract file names');
    it('should extract function names');
    it('should extract quoted strings');
  });
});
```

### 5. Examples to Test Against

```javascript
// Test cases the implementation must handle correctly:

"create a test for the auth module" 
// -> { taskType: 'create_test', entities: ['auth module'] }

"fix the TypeError in user.service.ts"
// -> { taskType: 'fix_bug', language: 'typescript', entities: ['user.service.ts', 'TypeError'] }

"refactor the React component to use hooks"
// -> { taskType: 'refactor', framework: 'react', entities: ['component', 'hooks'] }

"add a new endpoint to the Express router"
// -> { taskType: 'add_feature', framework: 'express', entities: ['endpoint', 'router'] }

"explain how the authentication flow works"
// -> { taskType: 'explain', entities: ['authentication flow'] }
```

## Important Constraints

1. **DO NOT MODIFY** any existing files in the project
2. **DO NOT CHANGE** any existing interfaces or method signatures
3. **DO NOT IMPORT** the new module into existing code (that will be done in Phase 2)
4. **ENSURE** all tests pass before completion
5. **MAINTAIN** the same code style as the existing codebase

## Deliverables

1. `src/core/pattern-detector.ts` - Main pattern detection logic
2. `src/services/pattern-service.ts` - Service wrapper for the detector
3. `tests/unit/pattern-detector.test.ts` - Comprehensive test suite
4. All tests passing with >90% code coverage

## Validation

Run these commands to validate the implementation:
```bash
npm test tests/unit/pattern-detector.test.ts
npm run lint src/core/pattern-detector.ts
npm run build
```

The build must succeed without any errors, and the new module should not affect any existing functionality.