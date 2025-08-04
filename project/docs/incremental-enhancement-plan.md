# Claude Recall - Incremental Enhancement Plan

## Current State (DO NOT CHANGE)
- ✅ Hook system captures all events reliably
- ✅ Memory storage in SQLite works perfectly  
- ✅ Basic keyword-based retrieval is functional
- ✅ Memories are injected when user mentions keywords

## Phase 1: Enhanced Context Capture (Non-Breaking)
**Goal**: Capture more context WITHOUT changing existing interfaces

### 1.1 Extend Context Object (Additive Only)
```typescript
// Current Context interface stays exactly the same
// We only ADD optional fields, never remove or change existing ones
export interface Context {
  // ... existing fields remain untouched ...
  
  // NEW optional fields:
  task_type?: string;      // 'create_test', 'fix_bug', 'refactor', etc.
  language?: string;       // 'typescript', 'python', etc.
  framework?: string;      // 'react', 'express', etc.
  recent_tools?: string[]; // Last 5 tools used in session
}
```

### 1.2 Pattern Detection Module (New File)
Create `src/core/patterns.ts` to detect task patterns:
```typescript
// This is a NEW module that doesn't touch existing code
export class PatternDetector {
  detectTaskType(prompt: string): string | undefined {
    // Simple pattern matching to start
    if (/create.*test|write.*test|add.*test/i.test(prompt)) {
      return 'create_test';
    }
    // ... more patterns ...
  }
}
```

## Phase 2: Smart Memory Search (Layered on Top)
**Goal**: Add intelligence WITHOUT changing storage or retrieval core

### 2.1 Create Memory Enhancer Service
New file `src/services/memory-enhancer.ts`:
```typescript
// This wraps existing MemoryService, doesn't replace it
export class MemoryEnhancer {
  constructor(private memoryService: MemoryService) {}
  
  async enhanceSearch(prompt: string): Promise<Memory[]> {
    // 1. Use existing search first
    const directMatches = this.memoryService.search(prompt);
    
    // 2. Detect patterns and search for related memories
    const taskType = this.patternDetector.detectTaskType(prompt);
    if (taskType === 'create_test') {
      const testPreferences = this.memoryService.search('test directory');
      return [...directMatches, ...testPreferences];
    }
    
    return directMatches;
  }
}
```

### 2.2 Update Hook to Use Enhancer
Minimal change to `user-prompt-submit-trigger.ts`:
```typescript
// Instead of:
const memories = memoryService.search(query);

// Use:
const enhancer = new MemoryEnhancer(memoryService);
const memories = await enhancer.enhanceSearch(query);
```

## Phase 3: Associative Memory (New Layer)
**Goal**: Build relationships WITHOUT changing storage schema

### 3.1 Memory Association Table (New)
Add new table that references existing memories:
```sql
-- This is ADDITIVE - doesn't touch existing tables
CREATE TABLE IF NOT EXISTS memory_associations (
  memory_id_1 TEXT,
  memory_id_2 TEXT,
  association_type TEXT,
  strength REAL,
  FOREIGN KEY (memory_id_1) REFERENCES memories(id),
  FOREIGN KEY (memory_id_2) REFERENCES memories(id)
);
```

### 3.2 Association Builder (Background Process)
New service that runs periodically:
```typescript
export class AssociationBuilder {
  // Finds memories used together and creates associations
  buildAssociations() {
    // Runs in background, doesn't affect real-time performance
  }
}
```

## Testing Strategy for Each Phase

### Phase 1 Testing
1. Verify existing functionality still works 100%
2. Test new context fields are captured when available
3. Ensure no performance regression

### Phase 2 Testing  
1. Original search must work exactly as before
2. Enhanced search should return additional relevant results
3. Measure response time stays under 100ms

### Phase 3 Testing
1. Associations built correctly in background
2. No impact on existing read/write operations
3. Association queries are performant

## Implementation Approach

1. **Create swarm task for Phase 1**:
   ```
   Implement PatternDetector module that analyzes user prompts 
   to detect task types like 'create_test', 'fix_bug', etc.
   DO NOT modify any existing files.
   ```

2. **Test Phase 1 thoroughly** before moving to Phase 2

3. **Iterate based on real usage** - see what patterns emerge

## Success Criteria
- Zero breaking changes to existing functionality
- Each phase can be rolled back independently
- Performance remains under 100ms for retrieval
- User experience only improves, never degrades

## Next Steps
1. Review this plan and refine if needed
2. Create detailed swarm task for Phase 1
3. Set up testing environment to validate no regressions