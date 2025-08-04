# Swarm Task: Phase 8.3 - Fix Memory Injection into Claude's Context

## Critical Issue
Claude Code is not injecting hook output into the assistant's decision-making context. Even though:
- ✅ Memories are captured and stored correctly
- ✅ Pattern detection identifies "create a test" properly  
- ✅ Memory enhancer retrieves "tests should be saved in tests-raoul/"
- ✅ Hook outputs the retrieved memories
- ❌ Claude doesn't receive these memories when making decisions

## Investigation Required

### 1. Analyze Claude-Flow's Approach
Research how claude-flow successfully injects memories into Claude's context:
- Check claude-flow's hook implementation
- Look for special output formats or protocols
- Identify any MCP tools or special mechanisms used
- Find how claude-flow ensures memories reach the assistant

### 2. Root Cause Analysis
Determine why current implementation fails:
- Is it a timing issue? (memories arrive too late)
- Is it a format issue? (emojis or formatting being filtered)
- Is it an architectural issue? (hooks can't inject into decision context)
- Is there a missing integration point?

### 3. Implement Solution
Based on findings, implement one of these approaches:

#### Option A: Format-Based Solution
- Remove emojis and special formatting
- Use plain text that Claude Code won't filter
- Test different output formats until injection works

#### Option B: MCP-Based Solution
- If claude-flow uses MCP tools for injection
- Implement similar MCP integration
- Ensure memories are available in assistant context

#### Option C: Alternative Injection Method
- Research if there's a different hook type for context injection
- Implement pre-response hook if available
- Find the correct integration point

### 4. Test Scenarios
The solution MUST pass these tests:
```
User: "create a test file"
Expected: Claude creates file in tests-raoul/ WITHOUT user mentioning directory

User: "where should tests be saved?"  
Expected: Claude knows "tests-raoul/" from memory

User: "fix the TypeError"
Expected: Claude has context about previous TypeError fixes
```

## Success Criteria
1. When user says "create a test", Claude automatically uses `tests-raoul/` directory
2. No manual intervention required
3. Memories are available BEFORE Claude makes decisions
4. Works consistently across sessions

## Implementation Notes
- Start by examining claude-flow's working implementation
- Test with simple outputs first (no formatting)
- Add logging to track exactly when hooks fire vs when Claude processes
- Consider that UserPromptSubmit might need different handling than other hooks

## Files to Examine
- Claude-flow's hook implementations (if accessible)
- `/src/cli/claude-recall-cli.ts` - Current output method
- `/src/services/hook.ts` - Memory formatting
- `.claude/settings.json` - Hook configuration

## Deliverables
1. Root cause analysis document
2. Working solution that injects memories into Claude's context
3. Updated hook implementation if needed
4. Test results showing successful memory injection
5. Documentation of the solution approach