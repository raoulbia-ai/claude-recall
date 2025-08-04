# Swarm Task: Phase 8.2 - Memory Enhancer Integration

## Task Description
Integrate the PatternDetector module with the memory retrieval system to provide intelligent, context-aware memory search. This enhancement must layer on top of existing functionality without breaking anything.

## Git Branch Setup
```bash
# Create and checkout new feature branch
git checkout -b feature/intelligent-memory-enhancement

# Ensure you're starting from latest main
git pull origin main
```

## Requirements

### 1. Create Memory Enhancer Service
Create a new file `src/services/memory-enhancer.ts` that wraps the existing MemoryService:

```typescript
import { MemoryService } from './memory';
import { PatternService } from './pattern-service';
import { Memory } from '../memory/storage';

export class MemoryEnhancer {
  private memoryService: MemoryService;
  private patternService: PatternService;
  
  constructor() {
    this.memoryService = MemoryService.getInstance();
    this.patternService = PatternService.getInstance();
  }
  
  async enhanceSearch(prompt: string): Promise<Memory[]> {
    // 1. Use existing search first (preserve current functionality)
    const directMatches = this.memoryService.search(prompt);
    
    // 2. Detect patterns in the prompt
    const patterns = this.patternService.analyzePrompt(prompt);
    
    // 3. Add task-specific memory searches
    const additionalMemories = this.getTaskSpecificMemories(patterns, prompt);
    
    // 4. Merge and deduplicate results
    return this.mergeAndRankMemories(directMatches, additionalMemories);
  }
  
  private getTaskSpecificMemories(patterns: DetectedPattern, prompt: string): Memory[];
  private mergeAndRankMemories(direct: Memory[], additional: Memory[]): Memory[];
}
```

### 2. Task-Specific Memory Rules
Implement these intelligent retrieval patterns:

#### For `create_test` task type:
- Search for memories containing "test directory", "test folder", "tests location"
- Search for memories with type "preference" related to testing
- Search for previous test file creations in the project

#### For `fix_bug` task type:
- Search for similar error messages or types
- Search for previous fixes in the same file
- Search for correction patterns related to the error

#### For `refactor` task type:
- Search for code style preferences
- Search for architectural patterns in the project
- Search for previous refactoring decisions

#### For `add_feature` task type:
- Search for project conventions and patterns
- Search for similar feature implementations
- Search for architecture decisions

### 3. Update Hook Integration
Modify ONLY the user-prompt-submit hook to use the enhancer:

```typescript
// In src/hooks/minimal/user-prompt-submit-trigger.ts
// Change this line:
const memories = memoryService.search(eventData.content);

// To this:
const enhancer = new MemoryEnhancer();
const memories = await enhancer.enhanceSearch(eventData.content);
```

### 4. Test Suite
Create comprehensive tests in `tests/unit/memory-enhancer.test.ts`:

```typescript
describe('MemoryEnhancer', () => {
  describe('enhanceSearch', () => {
    it('should return direct matches when no patterns detected');
    it('should include test preferences for create_test prompts');
    it('should include error history for fix_bug prompts');
    it('should include code conventions for refactor prompts');
    it('should deduplicate memories from multiple sources');
    it('should maintain relevance ranking');
    it('should handle empty results gracefully');
  });
  
  describe('task-specific retrieval', () => {
    it('should find test directory preferences for test creation');
    it('should find similar errors for bug fixes');
    it('should find coding standards for refactoring');
    it('should find architectural patterns for features');
  });
  
  describe('performance', () => {
    it('should complete search in under 100ms');
    it('should not block on pattern detection');
  });
});
```

### 5. Integration Tests
Create `tests/integration/intelligent-retrieval.test.ts`:

Test these real-world scenarios:
1. User says "create a test for auth" → System retrieves test directory preference
2. User says "fix TypeError" → System retrieves previous TypeError fixes
3. User says "refactor to use async" → System retrieves async/await preferences
4. User says "add user endpoint" → System retrieves API conventions

### 6. Examples to Validate

```javascript
// Scenario 1: Test creation without directory mention
Input: "create a test for the user service"
Expected: Should retrieve memory about "tests should be saved in tests-raoul/"

// Scenario 2: Bug fix with context
Input: "fix the undefined error in auth.js"
Expected: Should retrieve previous undefined error fixes and auth.js patterns

// Scenario 3: Refactoring with patterns
Input: "refactor this function to use modern syntax"
Expected: Should retrieve code style preferences like arrow functions, async/await

// Scenario 4: Feature with conventions
Input: "add a new API endpoint for products"
Expected: Should retrieve API routing patterns, naming conventions
```

## Important Constraints

1. **PRESERVE EXISTING FUNCTIONALITY** - Direct search must work exactly as before
2. **NO BREAKING CHANGES** - All existing tests must continue to pass
3. **PERFORMANCE** - Total search time must stay under 100ms
4. **BACKWARDS COMPATIBLE** - System must work even if pattern detection fails
5. **MINIMAL CHANGES** - Only modify the one line in user-prompt-submit hook

## Deliverables

1. `src/services/memory-enhancer.ts` - Smart wrapper around MemoryService
2. `tests/unit/memory-enhancer.test.ts` - Unit tests with >90% coverage
3. `tests/integration/intelligent-retrieval.test.ts` - Real-world scenario tests
4. Updated `src/hooks/minimal/user-prompt-submit-trigger.ts` - One line change only
5. All existing tests still passing

## Validation Commands

```bash
# Run all tests to ensure no regression
npm test

# Run specific new tests
npm test tests/unit/memory-enhancer.test.ts
npm test tests/integration/intelligent-retrieval.test.ts

# Check performance
npm test -- --testNamePattern="performance"

# Build and verify
npm run build

# Manual test
echo '{"content":"create a test for auth"}' | npx claude-recall capture user-prompt
# Should return test directory preferences even though "directory" wasn't mentioned
```

## Git Finalization
After validation:
```bash
# Commit changes
git add -A
git commit -m "feat: Add intelligent memory enhancement with pattern detection

- Implement MemoryEnhancer service for smart retrieval
- Add task-specific memory search rules
- Integrate with existing hooks (minimal change)
- Maintain backwards compatibility
- All tests passing, <100ms performance"

# Push feature branch
git push -u origin feature/intelligent-memory-enhancement

# After review, merge to main
git checkout main
git pull origin main
git merge feature/intelligent-memory-enhancement
git push origin main
```