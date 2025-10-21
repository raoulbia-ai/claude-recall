# Testing Learning Loop Integration

This guide walks through testing the new learning loop with context-manager agent.

## Prerequisites

1. Claude Code installed
2. Claude Recall MCP server configured in `~/.claude.json`
3. Empty or minimal memory database (for clean testing)

## Test 1: Verify .claude/ Directory is Recognized

**What to test:** Claude Code can read `.claude/CLAUDE.md`

**Steps:**
```bash
# 1. Navigate to this project
cd /mnt/c/Users/ebiarao/repos/claude-recall

# 2. Check if .claude/CLAUDE.md exists
cat .claude/CLAUDE.md | head -15

# 3. Start Claude Code in this directory
# Claude should read .claude/CLAUDE.md automatically
```

**Expected result:**
- Claude Code loads instructions from `.claude/CLAUDE.md`
- Ask Claude: "What instructions do you have for this project?"
- Claude should mention "learning loop" and "never repeat yourself"

## Test 2: Verify context-manager Agent is Available

**What to test:** The agent definition is readable

**Steps:**
```bash
# 1. Check agent file exists
cat .claude/agents/context-manager.md | head -20

# 2. In Claude Code, ask:
"What agents are available in this project?"
```

**Expected result:**
- Claude lists "context-manager" agent
- Agent description should mention "learning loop" and "multi-step search"

## Test 3: Test Learning Loop - Full Workflow

This is the main test that validates the entire learning loop.

### Step 3a: Store Initial Preference

**In Claude Code:**
```
You: "Remember: I prefer TypeScript with strict mode for all new files"
```

**Expected:**
- Claude stores preference using `mcp__claude-recall__store_memory`
- Confirms: "✓ Stored preference"

**Verify:**
```bash
npx claude-recall search "TypeScript strict" --json
```

Should return the stored preference.

### Step 3b: First Use - Apply Preference

**In Claude Code:**
```
You: "Create a simple calculator module"
```

**Expected:**
1. Claude spawns context-manager agent
2. Agent does multi-step search (preferences, successes, failures, corrections)
3. Agent finds: "TypeScript with strict mode"
4. Claude creates `calculator.ts` with TypeScript and strict mode
5. Agent returns context to Claude

**Verify:**
- File created: Look for `calculator.ts` or `src/calculator.ts`
- TypeScript used (not JavaScript)
- Strict mode enabled (check tsconfig or file content)

### Step 3c: Capture Success Outcome

**In Claude Code (after file creation):**
```
You: "Perfect! That's exactly what I wanted."
```

**Expected:**
1. Claude spawns context-manager agent again (post-action)
2. Agent detects positive feedback
3. Agent stores success: "Created calculator module with TypeScript strict mode - SUCCESS"

**Verify:**
```bash
npx claude-recall search "calculator success" --json
```

Should return the success outcome.

### Step 3d: Second Use - Automatic Application

**In Claude Code:**
```
You: "Create a validation utility module"
```

**Expected:**
1. Claude spawns context-manager agent
2. Agent finds: "TypeScript strict mode" + "Worked for calculator module"
3. Claude creates validation module with TypeScript strict mode WITHOUT asking
4. User doesn't have to repeat preference!

**Verify:**
- TypeScript used automatically
- Strict mode enabled automatically
- No questions about language or style

### Step 3e: Correction Loop

**In Claude Code:**
```
You: "No, put the validation file in src/utils/ not src/"
```

**Expected:**
1. Claude spawns context-manager agent (post-action)
2. Agent detects correction
3. Agent stores: "CORRECTION: Utility files go in src/utils/ not src/" (high priority)
4. Claude moves/recreates file immediately

**Verify:**
```bash
npx claude-recall search "correction utils" --json
```

Should return correction with type "correction".

### Step 3f: Apply Correction Automatically

**In Claude Code:**
```
You: "Create a logging utility"
```

**Expected:**
1. Claude spawns context-manager agent
2. Agent finds correction: "Utility files in src/utils/"
3. Claude creates file in `src/utils/logging.ts` (or similar) automatically
4. Correction applied without user repeating it

## Test 4: Multi-Step Search Verification

**What to test:** Agent performs all 4 searches

**In Claude Code:**
```
You: "Spawn the context-manager agent to gather context for creating an auth module"
```

**Expected agent workflow:**
- Search #1: `mcp__claude-recall__search("auth module preferences")`
- Search #2: `mcp__claude-recall__search("auth success")`
- Search #3: `mcp__claude-recall__search("auth failure")`
- Search #4: `mcp__claude-recall__search("auth correction")`
- Agent aggregates results
- Agent returns formatted response with:
  - ✅ Preferences section
  - ✅ Successes section (or "none found")
  - ❌ Failures section (or "none found")
  - 📝 Recommended approach

## Test 5: Failure Capture and Avoidance

**Step 5a: Store a Failure**

**In Claude Code:**
```
You: "Try using session-based authentication"
[Claude implements session-based auth]
You: "No, that doesn't work for our architecture. Use JWT tokens instead."
```

**Expected:**
1. Agent stores failure: "Session-based auth failed for this architecture"
2. Agent stores correction: "Use JWT tokens instead"

**Step 5b: Avoid Failed Approach**

**In Claude Code (later):**
```
You: "Implement authentication for the API"
```

**Expected:**
1. Agent searches and finds failure + correction
2. Agent warns: "❌ Session-based auth failed before → use JWT tokens"
3. Claude uses JWT tokens automatically
4. Failed approach is avoided

## Test 6: Priority System

**What to test:** Corrections override preferences

**Setup:**
```bash
# Store a preference
npx claude-recall store "I prefer tests in tests/ directory" --type preference

# Store a correction (higher priority)
npx claude-recall store "CORRECTION: Tests must go in __tests__/ not tests/" --type correction
```

**In Claude Code:**
```
You: "Create a test file for the calculator module"
```

**Expected:**
- Agent finds both preference AND correction
- Agent prioritizes correction (higher priority)
- Test file created in `__tests__/` (correction wins)
- Preference is overridden by correction

## Success Criteria

✅ `.claude/CLAUDE.md` is read by Claude Code
✅ `context-manager` agent is available
✅ Agent performs multi-step search (4 searches)
✅ Preferences are stored and applied
✅ Successes are captured and validated
✅ Failures are captured and avoided
✅ Corrections get highest priority
✅ User never repeats themselves
✅ Learning loop completes: preference → action → outcome → future application

## Troubleshooting

### Agent not found
- Check `.claude/agents/context-manager.md` exists
- Restart Claude Code to reload agent definitions

### Agent doesn't do multi-step search
- Check agent definition in `.claude/agents/context-manager.md`
- Agent should call `mcp__claude-recall__search` 4 times (preferences, successes, failures, corrections)

### MCP tools not available
- Verify: `claude mcp list` shows `claude-recall`
- Check: `~/.claude.json` has correct MCP server config
- Restart terminal

### Outcomes not being captured
- Agent needs to be spawned AFTER task completion
- User feedback must be clear ("Good!", "No, do this", "That failed")

### Corrections not prioritized
- Check memory type is "correction" not "preference"
- Agent should show corrections in "❌ What Didn't Work" section with highest priority

## Automated Test Script

Run the automated tests:
```bash
./test-agent-workflow.sh
```

This verifies:
- ✓ .claude/ structure exists
- ✓ context-manager agent exists
- ✓ Build completed
- ✓ Package includes .claude/
- ✓ Legacy hooks removed
- ✓ Can store and retrieve memories
- ✓ MCP server configured

## Next Steps

After tests pass:
1. Build the package: `npm run build`
2. Test in a real project
3. Verify learning loop works across multiple sessions
4. Export memories for backup: `npx claude-recall export backup.json`
