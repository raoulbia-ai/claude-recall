# Stage 1 Human Testing - Basic Hook Capture

## Overview
This test verifies that the Claude Recall hook system can successfully capture Claude Code tool usage events.

## Prerequisites
- Claude Code CLI installed and working
- Node.js environment available
- Terminal access

## Testing Steps

### 1. Build the Project
```bash
cd /workspaces/claude-recall/project
npm run build
```

**Expected Result**: Build completes without errors and creates `dist/` directory.

### 2. Install Hook Settings
```bash
# Copy Claude Code settings to your home directory
cp .claude/settings.json ~/.claude/settings.json

# Or if you have a custom Claude settings location:
# cp .claude/settings.json /path/to/your/claude/settings.json
```

**Expected Result**: Settings file copied successfully.

### 3. Test Hook Capture
Start a new Claude Code session and perform these actions:

1. **Create a test file**:
   - Ask Claude: "Create a simple hello world function in TypeScript"
   - Let Claude create the file using the Edit tool

2. **Make an edit**:
   - Ask Claude: "Change the function name to 'greetWorld'"
   - Let Claude edit the file

3. **Run a command**:
   - Ask Claude: "Run npm test to check if everything works"
   - Let Claude execute the Bash tool

### 4. Check Hook Capture Logs
```bash
# Check if hook capture log was created
ls -la hook-capture.log

# View the captured events
cat hook-capture.log
```

**Expected Results**:
- `hook-capture.log` file exists
- Log contains entries like:
  ```
  [timestamp] Pre-tool hook started
  [timestamp] Captured: PreToolUse - Edit
  [timestamp] Tool Input: {"file_path": "...", "content": "..."}
  [timestamp] Captured: PreToolUse - Bash
  [timestamp] Tool Input: {"command": "npm test"}
  ```

### 5. Verify Hook Performance
- During testing, Claude Code should remain responsive
- No noticeable delays when executing tools
- Hook execution should be transparent to user

## Success Criteria

✅ **Pass Criteria**:
- Hook capture log file is created
- Log contains "Captured: PreToolUse - Edit" entries
- Log contains "Captured: PreToolUse - Bash" entries  
- Claude Code remains responsive during hook execution
- No error messages in the log

❌ **Fail Criteria**:
- No log file created
- Log file empty or contains only error messages
- Claude Code becomes unresponsive
- Hook prevents tool execution

## Troubleshooting

### Issue: No log file created
- Check that settings.json is in the correct location
- Verify Node.js can execute the hook script:
  ```bash
  node /workspaces/claude-recall/project/dist/hooks/pre-tool.js
  ```

### Issue: Hook script errors
- Check the pre-tool.js file exists and is executable
- Verify all dependencies are installed:
  ```bash
  npm install
  npm run build
  ```

### Issue: Claude Code doesn't recognize hooks
- Verify Claude Code version supports PreToolUse hooks
- Check settings.json syntax is valid JSON
- Restart Claude Code after installing settings

## Test Results

After completing the test, record your results:

- [ ] Hook capture log created: ✅/❌
- [ ] Edit tool events captured: ✅/❌  
- [ ] Bash tool events captured: ✅/❌
- [ ] Claude Code performance acceptable: ✅/❌
- [ ] No errors in log: ✅/❌

**Overall Stage 1 Result**: ✅ PASS / ❌ FAIL

---

**Next Steps**: If all tests pass, proceed with automated test verification and commit the changes. If tests fail, investigate issues before continuing to Stage 2.