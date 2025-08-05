# Task 1: Fix Memory Search Not Being Triggered

## Critical Issue
Claude is NOT searching memory before taking actions. In the test case:
1. User stored: "recall tests to be saved in test-pasta/"
2. Claude successfully stored this in memory
3. User then said: "create a blank test script"
4. Claude created it in `tests/test-blank.js` instead of `test-pasta/test-blank.js`

**Claude completely ignored the stored memory about test location.**

## Root Cause Analysis

### Current CLAUDE.md Instructions (from postinstall.js)
The instructions say:
```
## MANDATORY: Search Memory on EVERY Prompt

**🚨 CRITICAL: YOU MUST call \`mcp__claude-recall__search\` AS YOUR FIRST ACTION before doing ANYTHING else.**
```

But Claude is NOT following these instructions.

### Why Instructions Are Not Working

1. **CLAUDE.md Location**: The instructions are in `~/CLAUDE.md` (global)
2. **Instruction Priority**: Claude may not be treating CLAUDE.md instructions as mandatory
3. **MCP Tool Visibility**: The search tool might not be prominently accessible

## Required Fixes

### Fix 1: Strengthen CLAUDE.md Instructions
Update postinstall.js to make instructions even more explicit:

```javascript
# CRITICAL SYSTEM REQUIREMENT - CLAUDE RECALL

YOU HAVE A MANDATORY SYSTEM REQUIREMENT:

1. **BEFORE ANY ACTION**: You MUST call mcp__claude-recall__search
2. **NO EXCEPTIONS**: Even for "hello", you MUST search first
3. **SEARCH KEYWORDS**: Extract ALL relevant terms from user's message

EXAMPLE VIOLATION (WRONG):
User: "create a test script"
You: *creates test in tests/*  ❌ WRONG - didn't search for stored location

EXAMPLE COMPLIANCE (CORRECT):
User: "create a test script"
You: *searches for "test script location directory"*
You: *finds "tests should be saved in test-pasta/"*
You: *creates test in test-pasta/* ✅ CORRECT

IF YOU SKIP SEARCH, YOU WILL CREATE FILES IN WRONG LOCATIONS.
```

### Fix 2: Add System-Level Integration
Consider if we need to:
1. Hook into Claude's file creation process
2. Add a pre-action validation layer
3. Create a more prominent reminder system

### Fix 3: Test Case for Verification
Create a test that verifies:
```bash
# Store preference
echo "save all tests in xyz-folder/" | claude

# Create test (should search and use xyz-folder/)
echo "create a test file" | claude

# Verify location
ls xyz-folder/  # Should contain the test file
```

## Implementation Steps

1. **Update postinstall.js** with stronger, clearer instructions
2. **Add visual separators** (═══════) to make instructions stand out
3. **Include failure examples** showing what happens when search is skipped
4. **Test with multiple scenarios** to ensure compliance

## Success Criteria

- Claude ALWAYS searches memory before file operations
- Claude uses stored locations (like test-pasta/) when creating files
- No manual intervention needed - it should be automatic

## Test Scenarios

1. **Location Preference Test**:
   - Store: "save all configs in settings/"
   - Action: "create a config file"
   - Expected: File created in settings/

2. **Multiple Preferences Test**:
   - Store: "tests in test-dir/, configs in conf-dir/"
   - Action: "create a test and a config"
   - Expected: Files in correct directories

3. **Override Test**:
   - Store: "tests in old-tests/"
   - Store: "tests in new-tests/"
   - Action: "create a test"
   - Expected: File in new-tests/ (latest preference)

## Current State Files

- `/workspaces/claude-recall/project/scripts/postinstall.js` - Creates CLAUDE.md
- `/workspaces/claude-recall/project/src/mcp/server.ts` - MCP server implementation
- `/workspaces/claude-recall/project/src/mcp/tools/memory-tools.ts` - Search tool implementation
- `~/CLAUDE.md` - Global instructions file (created by postinstall)

## Urgency: CRITICAL

This is the #1 issue preventing Claude Recall from working as designed. Without automatic memory search, the entire system fails its primary purpose.