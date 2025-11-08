# Troubleshooting Claude Recall

Common issues and solutions when working with Claude Recall memory system.

## Memories Not Being Found

### Problem: Search returns no results

**Cause 1: Search query too specific**

❌ Bad search:
```
mcp__claude-recall__search("python script test location in tests-arlo directory")
```

✅ Good search:
```
mcp__claude-recall__search("python script test location")
```

**Solution**: Use broader keywords. Search uses keyword matching, not exact phrases.

---

**Cause 2: Memory type mismatch**

If you stored as "devops" but searching for "preference", it won't be found (unless you search all types).

✅ Search all types:
```
mcp__claude-recall__search("testing approach")
```

---

**Cause 3: Memory doesn't exist**

Check what's actually stored:
```
mcp__claude-recall__get_recent_captures({ limit: 20 })
```

## Automatic Capture Not Working

### Problem: User stated preference but it wasn't captured

**Debugging Steps:**

1. **Check if it should be captured** - Review trigger words in `devops-patterns.md`

2. **Check confidence threshold** - Current minimum is 0.5 (50%)

3. **Verify pattern** - Some phrases are too vague:
   - ❌ "Maybe use React" (uncertain)
   - ✅ "Use React for frontend" (clear)

4. **Manual fallback** - If automatic didn't capture, store manually:
```javascript
mcp__claude-recall__store_memory({
  content: "[What you want to remember]",
  metadata: { type: "devops" }
})
```

### Problem: Too many memories being captured

If you're getting noise, check:

1. **Recent captures**:
```
mcp__claude-recall__get_recent_captures({ limit: 10 })
```

2. **Review confidence** - Memories with <0.6 confidence might be noise

3. **Clear unwanted memories** - Use CLI:
```bash
npx claude-recall search "unwanted phrase"
# Find the ID, then delete manually or clear by type
```

## Search Not Finding Relevant Memories

### Problem: Memory exists but search doesn't return it

**Cause**: Keywords don't match

**Example:**
- Stored: "Use pytest for testing"
- Searching: "test framework"
- Issue: "pytest" and "framework" don't overlap

**Solution 1**: Search with stored keywords:
```
mcp__claude-recall__search("pytest testing")
```

**Solution 2**: Use broader terms:
```
mcp__claude-recall__search("testing") // Returns all testing-related memories
```

**Solution 3**: Search by type:
```
mcp__claude-recall__retrieve_memory({
  query: "testing",
  sortBy: "timestamp"  // Get most recent
})
```

## Conflicting Memories

### Problem: Multiple memories contradict each other

**Example:**
- Memory 1: "Use Jest for testing"
- Memory 2: "Use Vitest for testing"

**Expected Behavior**: Newer memory should override if it has override signals.

**Check override status**:
```
mcp__claude-recall__search("testing framework")
```

Look for:
- `isOverride: true`
- Higher confidence on newer memory
- "FROM NOW ON", "UPDATED", "CHANGED TO" in content

**Manual override** if needed:
```javascript
mcp__claude-recall__store_memory({
  content: "CORRECTION: Use Vitest, not Jest, for all new projects",
  metadata: {
    type: "correction",
    priority: "highest",
    overrides: "jest"
  }
})
```

## MCP Tool Errors

### Error: "Tool not found: mcp__claude-recall__search"

**Cause**: MCP server not connected

**Check**:
```bash
claude mcp list
```

Should show:
```
claude-recall: npx claude-recall mcp start - ✓ Connected
```

**Fix if not connected**:
```bash
claude mcp remove claude-recall
claude mcp add --transport stdio claude-recall -- npx claude-recall mcp start
```

### Error: "ENOTEMPTY: directory not empty"

**Cause**: WSL/Windows file system issue

**Fix**:
```bash
rm -rf node_modules/claude-recall
npm install claude-recall@latest
```

## Performance Issues

### Problem: Searches are slow

**Cause 1**: Too many memories (>10,000)

**Check count**:
```bash
npx claude-recall stats
```

**Solution**: Clear old memories:
```bash
# Clear old tool-use memories (safe, these are low priority)
npx claude-recall clear --type tool-use --force

# Or clear by age
npx claude-recall clear --days 90
```

**Cause 2**: Database needs compaction

**Solution**: Automatic compaction happens at 10MB, but you can trigger:
```bash
# Compact happens automatically during normal operations
npx claude-recall stats  # This will trigger compact if needed
```

## Project-Specific Memories Not Loading

### Problem: Memories from Project A appearing in Project B

**Expected Behavior**: Memories are project-specific by default (stored with projectId)

**Check project context**:
```javascript
// Search should automatically filter to current project
mcp__claude-recall__search("devops")
```

**If cross-project bleed**:
1. Memories might be stored without projectId (old behavior)
2. Manual filter needed:

```javascript
mcp__claude-recall__search({
  query: "devops",
  filters: { projectId: "/path/to/current/project" }
})
```

## Database Corruption

### Problem: "Database disk image is malformed"

**Rare, but if it happens:**

**Solution 1**: Export and re-import
```bash
# Export existing memories
npx claude-recall export ~/backup-$(date +%Y%m%d).json

# Remove corrupted database
rm ~/.claude-recall/claude-recall.db

# Re-import
npx claude-recall import ~/backup-$(date +%Y%m%d).json
```

**Solution 2**: Start fresh (LAST RESORT)
```bash
# Backup first!
cp ~/.claude-recall/claude-recall.db ~/.claude-recall/claude-recall.db.backup

# Remove database
rm ~/.claude-recall/claude-recall.db

# Restart MCP server to recreate
```

## Debugging Tips

### Enable Debug Logging

```bash
# Run MCP server in debug mode
npm run mcp:debug
```

This shows:
- When memories are captured
- Search queries and results
- Confidence scores
- Pattern matches

### Check Raw Database

```bash
# View memories directly
npx claude-recall search ""  # Returns all memories

# Or use SQLite directly
sqlite3 ~/.claude-recall/claude-recall.db "SELECT * FROM memories LIMIT 10;"
```

### Test Patterns

Test if a phrase would be captured:

```javascript
// In a test conversation, say the phrase
"We use TDD for all new features"

// Then check
mcp__claude-recall__get_recent_captures({ limit: 1 })

// Should show the devops memory if pattern matched
```

## Getting Help

If none of these solutions work:

1. **Export memories for debugging**:
```bash
npx claude-recall export ~/debug-export.json
```

2. **Check version**:
```bash
npx claude-recall --version
```

3. **View stats**:
```bash
npx claude-recall stats
```

4. **File issue** with:
   - Version number
   - Error message
   - Steps to reproduce
   - Export file (if not sensitive)

## Quick Reference

```bash
# Check MCP connection
claude mcp list

# View recent memories
npx claude-recall search "" | head -20

# Check what was auto-captured
mcp__claude-recall__get_recent_captures({ limit: 10 })

# Manual storage
mcp__claude-recall__store_memory({
  content: "...",
  metadata: { type: "devops" }
})

# Clear by type
npx claude-recall clear --type tool-use --force

# Export backup
npx claude-recall export ~/backup.json
```
