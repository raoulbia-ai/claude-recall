## Stage 4 Human Testing - Memory Retrieval

Please test context-aware memory retrieval:

### Prerequisites
Make sure Stage 3 pattern recognition is working (patterns stored in database).

### 1. Build and Install
```bash
cd /workspaces/claude-recall/project
npm run build
cp .claude/settings-stage4.json ~/.claude/settings.json
```

### 2. Create Memories in Different Contexts

**Session 1 - Frontend Context:**
```bash
# Create a frontend project directory
mkdir -p ~/test-frontend
cd ~/test-frontend
```
- Start Claude Code in this directory
- Ask: "Create a React component for user authentication"
- When Claude uses `useState`, suggest using `useReducer` instead
- Ask: "What's our naming convention for React components?"
- Reply: "Always use PascalCase for components and camelCase for functions"

**Session 2 - Backend Context:**
```bash
# Create a backend project directory
mkdir -p ~/test-backend
cd ~/test-backend
```
- Start Claude Code in this directory
- Ask: "Create an Express API endpoint for user authentication"
- When Claude uses `res.send()`, correct to `res.json()`
- Ask: "What's our API response format?"
- Reply: "Always wrap responses in { success: boolean, data: any, error?: string }"

### 3. Test Context-Aware Retrieval

**Test 1 - Frontend Context Retrieval:**
```bash
cd ~/test-frontend
```
- Completely close Claude Code
- Start a fresh session
- Ask: "What naming convention should I use for components?"
- **Expected**: Should retrieve frontend-specific memory about PascalCase

**Test 2 - Backend Context Retrieval:**
```bash
cd ~/test-backend
```
- Ask: "How should I format API responses?"
- **Expected**: Should retrieve backend-specific memory about response format

### 4. Test Forgetting Curve (Time Decay)

Check relevance scores in the database:
```bash
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT key, relevance_score, 
   ROUND((julianday('now') - julianday(datetime(timestamp/1000, 'unixepoch'))), 2) as days_old,
   access_count
   FROM memories 
   WHERE type IN ('preference', 'correction-pattern')
   ORDER BY timestamp DESC LIMIT 10;"
```

### 5. Test Memory Injection in Hooks

Check if memories are being injected into Claude's context:
```bash
# Look for memory retrieval in logs
grep "Retrieved.*memories" /workspaces/claude-recall/project/hook-capture.log | tail -10

# Check for additionalContext output
grep "additionalContext" /workspaces/claude-recall/project/hook-capture.log | tail -5
```

### 6. Test Access Count Updates

1. Ask the same question multiple times:
   - "What's our naming convention?"
   - Wait a moment, ask again
   - Check database for increased access_count

```bash
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT key, access_count, last_accessed 
   FROM memories 
   WHERE access_count > 0 
   ORDER BY access_count DESC LIMIT 5;"
```

### Expected Results

✅ **Success Criteria:**
1. Memories are retrieved based on project context (frontend vs backend)
2. Recent memories have higher scores than old memories
3. Frequently accessed memories have boosted scores
4. Hook logs show "Retrieved X relevant memories"
5. Claude demonstrates knowledge from previous sessions

❌ **Failure Indicators:**
1. No memories retrieved when asking questions
2. Wrong context memories (backend memories in frontend project)
3. No access_count updates when retrieving memories
4. Hook logs show errors or timeouts

### Verification Commands

```bash
# Count memories by type
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT type, COUNT(*) FROM memories GROUP BY type;"

# Check for retrieved memories
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT COUNT(*) FROM memories WHERE last_accessed IS NOT NULL;"

# View recent memory retrievals
sqlite3 /workspaces/claude-recall/project/claude-recall.db \
  "SELECT key, type, access_count, 
   datetime(last_accessed/1000, 'unixepoch') as last_access 
   FROM memories 
   WHERE last_accessed IS NOT NULL 
   ORDER BY last_accessed DESC LIMIT 10;"
```

### Troubleshooting

If memories aren't being retrieved:
1. Check hook is running: `tail -f /workspaces/claude-recall/project/hook-capture.log`
2. Verify database exists and has memories
3. Check for errors in hook execution
4. Ensure Claude Code settings were copied correctly

Press Enter when testing is complete...