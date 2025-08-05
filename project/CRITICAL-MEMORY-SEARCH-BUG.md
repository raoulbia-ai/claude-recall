# CRITICAL BUG: Memory Search Not Being Triggered

## Bug Report

**Severity**: CRITICAL  
**Impact**: Core functionality broken - Claude ignores stored memories  
**Version**: 0.2.9  

## Reproduction Steps

1. User: `recall tests to be saved in test-pasta/`
   - Claude correctly stores this in memory ✅
   
2. User: `create a blank test script`
   - Claude creates in `tests/test-blank.js` ❌
   - Should create in `test-pasta/test-blank.js` ✅

## Root Cause

Claude is NOT executing the mandatory `mcp__claude-recall__search` before taking actions, despite explicit instructions in CLAUDE.md.

## Evidence

From user's test output:
```
> recall tests to be saved in test-pasta/
● claude-recall - mcp__claude-recall__store_memory (MCP)
  ⎿ "id": "memory_1754407058117_7qgnjbx8i", "success": true

> create a blank test script
● Write(tests/test-blank.js)  ← WRONG! Should be test-pasta/test-blank.js
```

Notice: NO search tool was called between storing and creating.

## Why Current Solution Fails

1. **CLAUDE.md instructions are not enforced**
   - Located at `~/CLAUDE.md`
   - Contains: "YOU MUST call search AS YOUR FIRST ACTION"
   - But Claude ignores this

2. **MCP tools are optional by design**
   - Claude treats them as available tools, not mandatory steps
   - No mechanism forces tool usage

3. **Postinstall creates instructions but can't enforce them**
   - We update CLAUDE.md but can't guarantee Claude reads/follows it

## Potential Solutions

### Solution 1: Middleware Approach (Recommended)
Create a request interceptor that:
1. Intercepts all user messages
2. Automatically triggers search
3. Injects results into context
4. Then passes to Claude

### Solution 2: Enhanced Instructions
Make instructions so prominent Claude can't ignore:
```
════════════════════════════════════════════════════════════
⚠️  SYSTEM CRITICAL: MEMORY SEARCH REQUIRED  ⚠️
════════════════════════════════════════════════════════════
BEFORE RESPONDING TO THIS MESSAGE:
1. MUST call mcp__claude-recall__search
2. MUST extract keywords from user's message
3. MUST use search results in your response

FAILURE TO SEARCH = SYSTEM VIOLATION
════════════════════════════════════════════════════════════
```

### Solution 3: Hook-Based Enforcement
Revive minimal hooks that:
1. Detect when Claude skips search
2. Block the action
3. Force search execution

### Solution 4: Different MCP Integration
Instead of relying on Claude to call tools:
1. Use MCP's context provision features
2. Automatically inject memories into every conversation
3. No manual search required

## Test Matrix

| Scenario | Current | Expected |
|----------|---------|----------|
| Store location + create file | Creates in default location ❌ | Creates in stored location ✅ |
| Ask about stored info | Doesn't search ❌ | Searches and finds ✅ |
| Multiple preferences | Uses defaults ❌ | Uses latest preference ✅ |

## Next Steps

1. **Immediate**: Update postinstall.js with stronger visual instructions
2. **Short-term**: Investigate MCP context injection capabilities
3. **Long-term**: Consider middleware/hook solution if instructions don't work

## Files to Review

- `/workspaces/claude-recall/project/scripts/postinstall.js` - Creates CLAUDE.md
- `/workspaces/claude-recall/project/src/mcp/server.ts` - Could add auto-search here?
- `/workspaces/claude-recall/project/src/mcp/tools/memory-tools.ts` - Search implementation
- `~/CLAUDE.md` - Current instructions (not being followed)

## Impact Statement

**This bug makes Claude Recall essentially useless.** The entire value proposition is that Claude remembers and uses stored information. If Claude doesn't search memory, it's just a storage system with no retrieval - defeating the entire purpose.