# Phase 8.6: Claude-Native Architecture Redesign Task

## Mission Statement
Eliminate redundant API calls and simplify claude-recall by adopting the proven claude-flow pattern: hooks for coordination only, Claude Code for all intelligence.

## Critical Architectural Insight

**DISCOVERY**: Claude-flow doesn't need API keys for NLP because it doesn't do NLP - Claude Code does!

### The Problem with Current Architecture (Phase 8.5)
```
User Input → Hook → API Call to Claude → Try to capture response → Action
```
**Issues:**
- Making API calls from INSIDE Claude to Claude (redundant)
- No mechanism to capture Claude's API responses in hooks
- Adding complexity to an already intelligent system
- Trying to analyze what Claude Code already understands

### Target Architecture (Claude-Native)
```
User Input → Claude Code (already intelligent) → Hooks (coordination/memory) → Action
```
**Benefits:**
- Zero redundant API calls
- Claude Code's native understanding is trusted
- Hooks focus on coordination and memory only
- Simpler, more reliable system

## Task Objectives

### Primary Goal
Refactor claude-recall to use Claude Code's native intelligence instead of making redundant API calls.

### Specific Tasks

#### 1. Eliminate Redundant API Services
**Remove these files:**
- `src/services/intelligent-preference-extractor.ts`
- `src/services/claude-nlp-analyzer.ts`
- Any dependencies on `@anthropic-ai/sdk`

**Rationale**: Claude Code already provides all the NLP we need.

#### 2. Simplify Hook Service
**Current Issue**: HookService tries to analyze user input with API calls
**Solution**: Let Claude Code naturally understand and act, hooks just store results

**Example Refactor:**
```typescript
// BEFORE (Phase 8.5) - Redundant Analysis
const nlpAnalysis = await this.intelligentExtractor.extractPreferences(content);

// AFTER (Phase 8.6) - Trust Claude Code
// Claude Code will naturally understand "moving forward create all tests in tests-arlo"
// Hook just needs to detect when Claude Code acts on preferences and store them
```

#### 3. Implement Behavioral Pattern Detection
Instead of analyzing text, detect Claude Code's behavioral patterns:

```typescript
// Detect when Claude Code creates files in specific directories
// Detect when Claude Code mentions preferences in its responses
// Store these patterns as preferences for future sessions
```

#### 4. Study Claude-Flow Architecture
**Research Task**: Analyze how claude-flow uses hooks:
- Look at `/workspaces/claude-recall/references/claude-flow/src/cli/simple-commands/hooks.js`
- Understand how they achieve coordination without NLP
- Identify patterns we can adopt

#### 5. Create Claude-Native Preference Detection
**New Approach**: Instead of analyzing user input, analyze Claude Code's actions:

```typescript
// When Claude Code creates a file in tests-arlo/, store preference
// When Claude Code mentions "I'll use tabs for indentation", store preference
// When Claude Code shows a pattern (like always using axios), store preference
```

## Implementation Strategy

### Phase A: Remove Redundant Components
1. Delete IntelligentPreferenceExtractor and ClaudeNLPAnalyzer
2. Remove @anthropic-ai/sdk dependency
3. Update HookService to remove API call logic
4. Ensure SemanticPreferenceExtractor remains as fallback

### Phase B: Implement Behavioral Detection
1. Create ActionPatternDetector that watches Claude Code's behavior
2. Detect file creation patterns (tests in specific directories)
3. Detect preference mentions in Claude Code's responses
4. Store behavioral patterns as preferences

### Phase C: Align with Claude-Flow Pattern
1. Study claude-flow hooks implementation
2. Adopt their coordination-only approach
3. Focus hooks on memory persistence and cross-session context
4. Remove all attempts at independent intelligence

## Success Metrics

### Technical Success
- ✅ Zero API calls from hooks to Claude
- ✅ No dependency on ANTHROPIC_API_KEY
- ✅ Reduced complexity in HookService
- ✅ Faster hook execution (no API latency)
- ✅ More reliable (no API failures)

### Functional Success
- ✅ Preferences still captured and stored
- ✅ Memory injection still works
- ✅ Natural language understanding maintained (via Claude Code)
- ✅ Cross-session persistence
- ✅ All existing tests pass

### Architectural Success
- ✅ Follows claude-flow's proven pattern
- ✅ Hooks are pure coordination tools
- ✅ Claude Code is the only intelligence source
- ✅ Simpler mental model for developers

## Test Plan

### Before Refactor
1. Document all current functionality that works
2. Create comprehensive test suite for existing behavior
3. Ensure all edge cases are covered

### During Refactor
1. Maintain green tests throughout refactor
2. Test that preferences are still captured (differently but effectively)
3. Verify memory injection continues working

### After Refactor
1. Performance testing (should be faster without API calls)
2. Reliability testing (should be more stable)
3. Edge case testing (should handle more variations)

## Risk Management

### Identified Risks
1. **Loss of NLP capability**: Mitigated by trusting Claude Code's native understanding
2. **Preference detection gaps**: Mitigated by behavioral pattern detection
3. **Backward compatibility**: Mitigated by keeping SemanticPreferenceExtractor as fallback

### Rollback Plan
- Keep Phase 8.5 implementation in a separate branch
- Maintain SemanticPreferenceExtractor as working fallback
- All changes must be additive/replaceable

## Claude-Flow Architecture Study

### Research Questions
1. How does claude-flow capture decisions without analyzing them?
2. What coordination patterns do they use?
3. How do they maintain cross-session context?
4. What can we learn from their hook implementations?

### Key Files to Study
- `/workspaces/claude-recall/references/claude-flow/src/cli/simple-commands/hooks.js`
- `/workspaces/claude-recall/references/claude-flow/src/cli/simple-commands/init/templates/settings.json`
- Any memory management implementations

## Expected Outcome

A simpler, more reliable claude-recall that:
- Trusts Claude Code's native intelligence
- Uses hooks purely for coordination and memory
- Eliminates redundant API calls and complexity
- Maintains all current functionality
- Follows the proven claude-flow architectural pattern
- Is faster and more reliable than Phase 8.5

## Swarm Instructions

### Agent Roles Needed
1. **Researcher**: Study claude-flow architecture and patterns
2. **Architect**: Design the Claude-native architecture
3. **Refactor-Specialist**: Remove redundant API components
4. **Behavior-Analyst**: Implement behavioral pattern detection
5. **Test-Engineer**: Ensure no functionality regression

### Coordination Protocol
All agents must coordinate through the existing swarm memory system and provide regular progress updates.

### Priority Order
1. Research claude-flow patterns (highest priority)
2. Design new architecture 
3. Remove redundant components
4. Implement behavioral detection
5. Test and validate (continuous throughout)

This refactor represents a fundamental architectural improvement based on the insight that we don't need to add intelligence to an already intelligent system - we just need to coordinate with it effectively.