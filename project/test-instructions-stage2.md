## Stage 2 Human Testing - Memory Storage

Please test memory persistence:

1. Build and install latest hooks:
   ```
   cd /workspaces/claude-recall/project
   npm run build
   cp .claude/settings.json ~/.claude/settings.json
   ```

2. Start Claude Code and perform actions:
   - Ask: "Create a function to authenticate users"
   - Let Claude create the function
   - Edit the function name from `authenticateUser` to `validateUser`

3. Check if memory was stored:
   ```
   sqlite3 /workspaces/claude-recall/project/claude-recall.db \
     "SELECT * FROM memories WHERE type='tool-use' LIMIT 5;"
   ```

4. Restart Claude Code and verify persistence:
   - Close Claude Code completely
   - Start it again
   - Check if the database still has the memories

Expected: Database should contain tool-use events and persist after restart.

Press Enter when testing is complete...