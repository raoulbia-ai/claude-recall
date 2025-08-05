# Claude Recall MCP Server User Guide

## Installation

### Global Installation (Recommended)
```bash
npm install -g claude-recall
```

### Local Installation
```bash
npm install claude-recall
```

## Adding to Claude Code

```bash
# For global installation
claude mcp add claude-recall claude-recall mcp start

# For local installation
claude mcp add claude-recall npx claude-recall mcp start
```

## Available Tools

### 1. Store Memory
**Tool**: `mcp__claude-recall__store_memory`
**Purpose**: Save important information for future recall

Example:
```
Store this memory: The user prefers TypeScript over JavaScript for all new projects
```

### 2. Search Memories
**Tool**: `mcp__claude-recall__search`
**Purpose**: Find previously stored information

Example:
```
Search my memories for: TypeScript preferences
```

### 3. Retrieve Memory
**Tool**: `mcp__claude-recall__retrieve_memory`
**Purpose**: Get specific memories by ID or recent memories

Example:
```
Retrieve my recent memories about coding preferences
```

### 4. Get Statistics
**Tool**: `mcp__claude-recall__get_stats`
**Purpose**: View memory usage statistics

Example:
```
Show me my Claude Recall statistics
```

### 5. Clear Context
**Tool**: `mcp__claude-recall__clear_context`
**Purpose**: Clear session-specific context

Example:
```
Clear my current Claude Recall context (confirm: true)
```

## Memory Persistence

- Memories are stored in a local SQLite database
- Sessions persist across Claude Code restarts
- Database location: `~/.claude-recall/claude-recall.db`
- Session data: `~/.claude-recall/sessions.json`

## Troubleshooting

### MCP Server Not Starting
1. Check Claude Code logs: `~/.claude-code/logs/`
2. Test manually: `claude-recall mcp start`
3. Verify installation: `which claude-recall`

### Memories Not Persisting
1. Check database permissions: `ls -la ~/.claude-recall/`
2. Verify disk space: `df -h`
3. Check logs for errors

### Rate Limiting
- Default: 100 requests per minute per session
- If rate limited, wait 60 seconds
- Check current usage with health endpoint

## Advanced Configuration

### Environment Variables
- `CLAUDE_RECALL_DB_PATH`: Custom database location
- `CLAUDE_RECALL_LOG_LEVEL`: Set to 'debug' for verbose logging
- `CLAUDE_RECALL_RATE_LIMIT`: Custom rate limit (default: 100)

### Debug Mode
```bash
# Run with debug logging
NODE_ENV=development DEBUG=claude-recall:* claude-recall mcp start
```

## Migration from File Watcher

If you were using the old file watcher version:
1. Export your memories: `claude-recall export`
2. Install new version: `npm install -g claude-recall@latest`
3. Add MCP server: `claude mcp add claude-recall claude-recall mcp start`
4. Import memories: `claude-recall import memories.json`