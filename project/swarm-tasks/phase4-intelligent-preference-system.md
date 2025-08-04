# Swarm Task: Phase 8.4 - Intelligent Preference System with LLM Understanding

## Critical Issue
The current preference system has two major flaws:
1. **Rigid Pattern Matching**: Only captures specific phrases like "tests should be saved in X", missing natural expressions like "moving forward create all tests in tests-arlo"
2. **No Override Logic**: Old preferences persist forever - saying "tests in tests-arlo" doesn't override "tests in tests-raoul"

## Required Implementation

### 1. LLM-Based Preference Extraction
Replace regex patterns with intelligent extraction:

#### Current (Broken) Approach:
```typescript
// Only matches exact patterns
/save\s+(\w+)\s+in\s+(\w+)/gi  // "save tests in X"
```

#### Required Approach:
Use the existing PatternDetector or create a PreferenceExtractor that:
```typescript
class PreferenceExtractor {
  extractPreferences(prompt: string): Preference[] {
    // Use LLM-style understanding to detect:
    // - "moving forward, create all tests in tests-arlo"
    // - "from now on, use pytest instead of unittest"
    // - "going forward, save configs in the config directory"
    // - "I changed my mind, put tests in test-new"
    // - "actually, let's use a different location for tests: tests-v2"
  }
  
  detectOverrideIntent(prompt: string): boolean {
    // Detect if user is updating/replacing a preference:
    // - "moving forward", "from now on", "going forward"
    // - "changed my mind", "actually", "instead"
    // - "update", "replace", "new location"
  }
}
```

### 2. Preference Override System
Implement logic to handle preference updates:

#### Database Schema Addition:
```sql
-- Add to memories table or create preference_overrides table
ALTER TABLE memories ADD COLUMN supersedes_id TEXT;
ALTER TABLE memories ADD COLUMN preference_key TEXT; -- e.g., "test_location", "code_style"
```

#### Override Logic:
```typescript
class PreferenceManager {
  storePreference(preference: Preference, context: Context) {
    // 1. Extract preference key (e.g., "test_location" from "tests should be in X")
    const key = this.extractPreferenceKey(preference);
    
    // 2. Check for override intent
    if (this.hasOverrideIntent(context.prompt)) {
      // Mark old preferences as superseded
      this.markSuperseded(key, preference.id);
    }
    
    // 3. Store new preference with key
    this.storage.storeWithKey(preference, key);
  }
  
  getActivePreferences(): Preference[] {
    // Only return preferences that aren't superseded
    return this.storage.getActivePreferences();
  }
}
```

### 3. Natural Language Understanding
Enhance the system to understand various ways users express preferences:

#### Examples to Support:
```
"moving forward, create all tests in tests-arlo"
→ Preference: test_location = tests-arlo (overrides previous)

"from now on, use 4 spaces instead of tabs"
→ Preference: indentation = 4_spaces (overrides previous)

"I prefer axios over fetch for API calls"
→ Preference: http_client = axios

"actually, save the test files in __tests__ instead"
→ Preference: test_location = __tests__ (overrides previous)

"let's go back to saving tests in tests-raoul"
→ Preference: test_location = tests-raoul (overrides previous)
```

### 4. Retrieval Enhancement
Update memory retrieval to only show active preferences:

```typescript
formatRetrievedMemories(memories: Memory[]): string {
  // Group preferences by key
  const preferencesByKey = this.groupPreferencesByKey(memories);
  
  // Only show the latest preference for each key
  const activePreferences = this.getLatestPreferences(preferencesByKey);
  
  // Format clearly
  return this.formatActivePreferences(activePreferences);
}
```

### 5. Test Scenarios
Ensure these work correctly:

```bash
# Scenario 1: Initial preference
User: "tests should be saved in tests-raoul"
System: Captures preference: test_location = tests-raoul

# Scenario 2: Override preference  
User: "moving forward, create all tests in tests-arlo"
System: Captures preference: test_location = tests-arlo (supersedes tests-raoul)

# Scenario 3: Query after override
User: "create a test file"
System: Uses tests-arlo/ (not tests-raoul/)

# Scenario 4: Another override
User: "actually, I changed my mind, put tests in __tests__"
System: Captures preference: test_location = __tests__ (supersedes tests-arlo)
```

## Implementation Strategy

### Option A: Extend PatternDetector
- Add preference detection to existing pattern detector
- Use semantic matching instead of regex
- Identify override intent from context

### Option B: Create PreferenceExtractor Service
- New service dedicated to preference extraction
- Uses NLP techniques to understand intent
- Integrates with existing MemoryService

### Option C: Hybrid Approach (Recommended)
- Keep simple regex for common patterns (fast path)
- Fall back to intelligent extraction for complex cases
- Use both for maximum coverage

## Deliverables

1. **Intelligent Preference Extraction**
   - LLM-based understanding of preference expressions
   - Support for natural language variations
   - Override intent detection

2. **Preference Override System**
   - Database schema updates (if needed)
   - Logic to supersede old preferences
   - Only return active preferences

3. **Enhanced Retrieval**
   - Group preferences by key
   - Show only latest preference per key
   - Clear formatting for Claude

4. **Comprehensive Tests**
   - Test natural language variations
   - Test override scenarios
   - Test preference persistence

## Success Criteria

1. ✅ "moving forward, create all tests in tests-arlo" is captured as a preference
2. ✅ New preferences override old ones (tests-arlo replaces tests-raoul)
3. ✅ Only the latest preference for each type is shown to Claude
4. ✅ Natural language understanding of preferences
5. ✅ Clear indication when preferences are updated/replaced

## Important Notes

- Maintain backwards compatibility with existing preferences
- Don't delete old preferences (mark as superseded for history)
- Handle edge cases like conflicting preferences gracefully
- Ensure performance remains under 100ms