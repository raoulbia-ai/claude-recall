# Swarm Task: Phase 8.5 - True NLP Integration with Claude Code

## Critical Requirement
DO NOT BREAK EXISTING FUNCTIONALITY. The hooks work perfectly - they capture and inject memories. Build ON TOP of what exists.

## Problem Statement
Current PreferenceExtractor uses hardcoded patterns, not true NLP. We need Claude Code itself to do the natural language understanding, not regex patterns.

## Solution Architecture

### Core Insight
Claude Code already has the best NLP engine - Claude itself! Instead of trying to replicate NLP with patterns, we should:
1. Capture the raw user input (already working)
2. Let Claude analyze it for preferences during the hook execution
3. Store Claude's understanding as structured preferences

### Implementation Approach

#### Option A: Dual-Pass Hook System (Recommended)
1. **First Pass** (existing): Capture raw input and inject memories
2. **Second Pass** (new): Claude analyzes its own response for preference understanding

```typescript
// In user-prompt-submit hook, after memory injection
if (promptIndicatesPreference(content)) {
  // Instead of regex extraction, create a marker for Claude
  return {
    additionalContext: formattedMemories,
    preferenceAnalysisRequest: {
      prompt: content,
      instruction: "PREFERENCE_ANALYSIS: If this expresses a preference, respond with: PREF[key:value]"
    }
  };
}
```

#### Option B: Response Analysis Hook
Create a new hook type that analyzes Claude's responses:
1. Claude naturally understands "moving forward, create all tests in tests-arlo"
2. Response hook captures when Claude acknowledges preferences
3. Extracts and stores the understood preference

#### Option C: Enhanced Memory Format
Modify memory injection to include analysis instructions:
```
Current preferences and instructions:
- tests should be saved in tests-raoul/

ANALYZE_NEW_PREFERENCE: "moving forward, create all tests in tests-arlo"
If this updates an existing preference, note: PREF_UPDATE[test_location:tests-arlo]
```

### Key Requirements

1. **Preserve Existing System**
   - All current hooks continue working
   - Memory injection remains unchanged
   - Pattern-based extraction remains as fallback

2. **Add Claude-Powered NLP**
   - Claude analyzes natural language
   - System captures Claude's understanding
   - Stores structured preferences from Claude's analysis

3. **Seamless Integration**
   - No user-visible changes
   - Automatic preference understanding
   - Works with any natural language variation

### Implementation Steps

1. **Create Preference Analysis Protocol**
   - Define how Claude signals preference understanding
   - Add markers that won't confuse users
   - Capture Claude's interpretation

2. **Extend Hook System**
   - Add preference analysis phase
   - Capture Claude's structured output
   - Store in existing preference system

3. **Test Natural Variations**
   ```
   "hey, let's put tests in test-new from now on"
   "I think tests belong in the testing folder"
   "actually, use __test__ for test files"
   "you know what, save tests under src/tests"
   ```

### Example Flow

1. User: "from now on, put all test files in test-v2"
2. Hook captures and injects current memories
3. Hook adds analysis marker: "ANALYZE_PREFERENCE: from now on, put all test files in test-v2"
4. Claude understands this means test_location should be test-v2
5. Claude's response includes: "PREF[test_location:test-v2]"
6. System captures and stores this structured preference

### Success Criteria

1. **Zero Breaking Changes**
   - All existing tests pass
   - Current functionality unchanged
   - Performance maintained

2. **True NLP Understanding**
   - Works with ANY natural language variation
   - No new hardcoded patterns
   - Claude does the understanding

3. **Seamless Experience**
   - Users don't see analysis markers
   - Preferences captured automatically
   - Works in normal conversation flow

### DO NOT
- Break existing hooks
- Modify core memory injection
- Add complex regex patterns
- Create new dependencies
- Change database schema (unless extending)

### DO
- Build on top of existing system
- Use Claude's NLP capabilities
- Keep it simple and elegant
- Test thoroughly before integration
- Maintain backwards compatibility