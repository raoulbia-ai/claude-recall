## Stage 5 Human Testing - Complete Hook Integration

This is the critical test to ensure the enhanced pre-tool hook is executing and memories are being retrieved and injected into Claude's context.

### Prerequisites
- Stage 4 must be complete (memories stored in database)
- Enhanced pre-tool hook must be built

### 1. Build and Install Enhanced Hook
```bash
cd /workspaces/claude-recall/project
npm run build
cp .claude/settings.json ~/.claude/settings.json
```

### 2. Verify Hook Configuration
Check that the settings now use the enhanced hook:
```bash
grep "pre-tool-enhanced" ~/.claude/settings.json
# Should show: "command": "node /workspaces/claude-recall/project/dist/hooks/pre-tool-enhanced.js"
```

### 3. Test Full Memory Lifecycle

**Session 1 - Learning Phase:**
```bash
# Clear previous logs for clean test
rm -f /workspaces/claude-recall/project/hook-capture.log

# Create a test project
mkdir -p ~/test-recall
cd ~/test-recall
```

1. Start Claude Code in this directory
2. Create some patterns and preferences:
   - Ask: "Create a user authentication system"
   - When Claude uses `checkAuth()`, correct to `validateAuth()`
   - When Claude uses `var`, correct to `const`
   - Ask: "What's our coding standard for variables?"
   - Reply: "Always use const for immutable values, let for mutable"
   - Ask: "How should we name authentication functions?"
   - Reply: "Always prefix with 'validate' not 'check'"

3. Verify memories were captured:
```bash
# Check hook log
tail -20 /workspaces/claude-recall/project/hook-capture.log

# Check database
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT type, COUNT(*) FROM memories GROUP BY type;"
```

**Session 2 - Memory Retrieval Test:**

1. **Completely close Claude Code** (this is important!)
2. Wait 10 seconds to ensure clean session
3. Start a fresh Claude Code session in the same directory:
```bash
cd ~/test-recall
```

4. Test memory retrieval:
   - Ask: "Write an authentication check function"
   - **Expected**: Claude should suggest `validateAuth` (not `checkAuth`)
   - Ask: "Should I use var or const?"
   - **Expected**: Claude should recommend const based on previous learning

5. Check if memories were retrieved and injected:
```bash
# Look for memory retrieval in the most recent log entries
grep "Retrieved.*memories" /workspaces/claude-recall/project/hook-capture.log | tail -5

# Check for additionalContext output (this is what gets injected)
grep "additionalContext" /workspaces/claude-recall/project/hook-capture.log | tail -5

# Verify hook is using enhanced version
grep "memory retrieval" /workspaces/claude-recall/project/hook-capture.log | tail -1
```

### 4. Test Pattern Recognition Integration

1. Make several similar corrections:
   - Create functions with "get" prefix
   - Correct them to "fetch" prefix
   - Do this 3-4 times

2. Check pattern storage:
```bash
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT value FROM memories WHERE type='correction-pattern' LIMIT 5;" | python3 -m json.tool
```

3. In a new session, create a similar function:
   - Ask: "Create a function to get user data"
   - **Expected**: Based on patterns, Claude might suggest or you'll see memories about fetch vs get

### 5. Verify Memory Injection Format

Check the exact format of injected memories:
```bash
# Extract the most recent additionalContext
grep -o '"additionalContext":[^}]*' /workspaces/claude-recall/project/hook-capture.log | tail -1
```

Expected format should include:
- 🧠 Relevant memories header
- Numbered list of memories
- Pattern corrections with frequency
- File/project context

### 6. Performance Check

The enhanced hook should still execute quickly:
```bash
# Check hook execution times
grep "hook started\|Exit" /workspaces/claude-recall/project/hook-capture.log | tail -20
```

### Expected Results

✅ **Success Criteria:**
1. Hook log shows "Pre-tool hook started with memory retrieval"
2. Memories are retrieved: "Retrieved X relevant memories"
3. additionalContext is output to stdout
4. Claude demonstrates knowledge from previous sessions
5. Pattern corrections influence suggestions
6. Hook executes in under 100ms

❌ **Failure Indicators:**
1. Hook log shows "Pre-tool hook started" (without "with memory retrieval")
2. No "Retrieved X memories" messages
3. No additionalContext in logs
4. Claude doesn't remember previous corrections
5. Hook timeouts or errors

### Troubleshooting

If enhanced hook isn't working:

1. Verify the built file exists:
```bash
ls -la /workspaces/claude-recall/project/dist/hooks/pre-tool-enhanced.js
```

2. Check for TypeScript compilation errors:
```bash
cd /workspaces/claude-recall/project
npx tsc --noEmit
```

3. Test hook directly:
```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"test.js"}}' | \
  node /workspaces/claude-recall/project/dist/hooks/pre-tool-enhanced.js
```

4. Check Claude Code is using correct settings:
```bash
# The settings should be in the Claude Code config directory
cat ~/.claude/settings.json | grep pre-tool
```

### Manual Verification Steps

1. **Database Inspection:**
```bash
# Count total memories
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT COUNT(*) as total_memories FROM memories;"

# Check memories with context
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT key, type, project_id, file_path FROM memories WHERE project_id IS NOT NULL LIMIT 10;"
```

2. **Hook Log Analysis:**
```bash
# Count hook executions
grep -c "Pre-tool hook started" /workspaces/claude-recall/project/hook-capture.log

# Count successful memory retrievals
grep -c "Retrieved.*memories" /workspaces/claude-recall/project/hook-capture.log
```

Press Enter when testing is complete...