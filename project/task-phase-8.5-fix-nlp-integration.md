# Task: Fix Phase 8.5 NLP Integration

## Problem Summary
Current implementation injects HTML markers but has no way to capture Claude's analysis response. This makes the NLP integration non-functional.

## Requirements
1. DO NOT break existing functionality
2. Build on top of current system
3. Implement a COMPLETE solution, not partial

## Recommended Implementation

### Solution: Semantic Intent Matching
Since we cannot capture Claude's responses, implement intelligent semantic matching that doesn't require exact patterns.

1. **Create SemanticPreferenceExtractor**
   - Use word embeddings or semantic similarity
   - Match intent, not exact phrases
   - Score confidence based on semantic overlap

2. **Enhance with Context**
   ```typescript
   class SemanticPreferenceExtractor {
     extractPreference(prompt: string, context: Context): ExtractedPreference | null {
       // Identify intent category
       const intent = this.identifyIntent(prompt);
       
       // Extract key components
       const components = this.extractComponents(prompt, intent);
       
       // Build structured preference
       return this.buildPreference(intent, components);
     }
     
     private identifyIntent(prompt: string): PreferenceIntent {
       // Use semantic matching to identify:
       // - Location preference (save X in Y)
       // - Tool preference (use X for Y)  
       // - Style preference (prefer X over Y)
       // - Process preference (always/never do X)
     }
   }
   ```

3. **Multi-Signal Detection**
   - Combine multiple weak signals for high confidence
   - Look for: action words + entities + locations
   - Consider context and word proximity

4. **Test Cases**
   Must handle ALL of these naturally:
   - "hey, lets put tests in test-new from now on"
   - "I think tests belong in the testing folder"
   - "tests go in __test__ going forward"
   - "actually, save test files under src/tests"
   - "you know what, use test-v2 for tests"

5. **Remove Non-Functional Code**
   - Remove HTML comment injection (doesn't work)
   - Remove response handler (never called)
   - Keep working preference storage

## Success Criteria
1. Natural language variations captured correctly
2. No hardcoded patterns for specific phrases
3. Confidence scoring based on semantic understanding
4. All existing tests still pass
5. New test suite for semantic matching

## Note
If semantic matching is too complex, implement a learning system that improves patterns based on corrections, but do NOT add more hardcoded regex patterns.