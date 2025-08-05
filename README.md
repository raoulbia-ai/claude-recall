# Claude Recall

An MCP server that gives Claude persistent memory across conversations.

## The Story

Every time you start a new conversation with Claude, you're starting from scratch. Claude doesn't remember your preferences, your project context, or the decisions you've made together. Until now.

**Claude Recall** is an MCP (Model Context Protocol) server that captures and stores memories from your Claude Code sessions. It learns from your interactions and provides relevant context in future conversations, making Claude feel like a true collaborator who remembers your journey together.

## What Makes It Special

- **Persistent Memory**: Your preferences, decisions, and context persist across Claude sessions
- **Intelligent Retrieval**: Automatically surfaces relevant memories based on your current work
- **Privacy First**: All memories stored locally in SQLite - your data never leaves your machine
- **MCP Native**: Built on Anthropic's official Model Context Protocol for seamless integration
- **Zero Configuration**: Start capturing memories immediately after installation
- **Lightweight**: SQLite database with automatic memory management

## 🚀 Quick Start

### 1. Install Claude Recall

```bash
npm install -g claude-recall
```

**Note**: Installation automatically configures Claude Recall in your `~/.claude.json` file.

### 2. Restart Claude Code

If Claude Code is currently running, restart it to load the new MCP server.

### 3. Start Using Claude

Launch Claude Code and your memories will be captured automatically. Claude Recall provides these MCP tools:

- `store_memory` - Save important information
- `search` - Search through your memories  
- `retrieve_memory` - Get specific memories
- `get_stats` - View memory statistics
- `clear_context` - Clear session context

## How It Works

Claude Recall uses the Model Context Protocol to integrate directly with Claude Code. When you:
- Use tools or run commands - it captures the patterns
- Express preferences - it remembers them
- Make decisions - it stores the context
- Start new conversations - it provides relevant memories

All of this happens automatically through MCP, without any manual configuration.

## Real-World Example

```
Monday: "Use PostgreSQL for our database and store configs in YAML files"
Tuesday: "What database should we use?" 
Claude: "Based on our previous conversations, we decided to use PostgreSQL for the database
and YAML for configuration files."
```

## Architecture

Claude Recall is built as a modern MCP server with a clean architecture:

```
MCP Protocol → Server → Services → SQLite Storage
```

- **MCP Server**: Handles protocol communication with Claude Code
- **Service Layer**: Manages memory operations and intelligence
- **Local Storage**: SQLite database for fast, private storage

## CLI Commands

While the MCP server handles automatic memory capture, you can also use the CLI:

```bash
# View statistics
claude-recall stats

# Search memories
claude-recall search "database choices"

# Export memories
claude-recall migrate export

# MCP server management
claude-recall mcp start  # Usually automatic via Claude Code
claude-recall mcp test   # Test the MCP server
```

## Migration from Earlier Versions


# 3. Register the MCP server
claude mcp add claude-recall

# 4. Import your memories
claude-recall migrate import claude-recall-export.json
```

## Installation Details

The npm installation automatically:
- Installs the Claude Recall CLI globally
- Configures the MCP server in your `~/.claude.json` file
- Creates a database directory at `~/.claude-recall/`
- Sets up the proper command structure for Claude Code integration

### Database Location

Your memories are stored in: `~/.claude-recall/claude-recall.db`

This keeps your data:
- Out of project directories
- In a consistent location
- Safe from accidental deletion
- Easy to backup

### Database & Storage

Claude Recall uses SQLite for fast, reliable local storage:

- **Single database**: One database for all projects at `~/.claude-recall/claude-recall.db`
- **Cross-project intelligence**: Learn once, apply everywhere
- **Project isolation**: Memories are tagged by project for contextual retrieval
- **Zero dependencies**: SQLite is embedded, no database server needed
- **Portable**: Easy to backup, restore, or transfer your memories

### Memory Management

Claude Recall automatically manages memory to prevent unlimited growth:
- **Auto-compaction**: When database exceeds 10MB
- **Memory limits**: Maximum 10,000 memories (older entries are cleaned up)
- **Smart retention**: Preferences and project knowledge are kept forever
- **Tool-use history**: Limited to most recent 1,000 entries

No manual configuration needed!

## Privacy & Security

- **100% Local**: All data stored in SQLite on your machine
- **No Telemetry**: Zero data collection or phone-home behavior
- **You Own Your Data**: Export and delete at any time
- **Open Source**: Inspect the code yourself

## Advanced Usage

### Custom Memory Storage

You can manually store memories for specific contexts:

```javascript
// In Claude Code, use the MCP tool:
await mcp__claude-recall__store_memory({
  content: "Always use 2 spaces for indentation in this project",
  metadata: { type: "preference", project: "my-app" }
})
```

### Memory Search

Search through your memories programmatically:

```javascript
// Find all database-related decisions
const memories = await mcp__claude-recall__search({
  query: "database",
  limit: 10
})
```

## Troubleshooting

### MCP Server Not Found

If Claude Code can't find the MCP server:

1. Ensure Claude Code was not running when you ran `claude mcp add`
2. Try: `claude-recall mcp test` to verify the server works
3. Check logs: `claude-recall status`

### Memories Not Appearing

1. Verify installation: `claude-recall validate`
2. Check stats: `claude-recall stats`
3. Ensure MCP tools are being used in Claude Code

## Contributing

We welcome contributions! Claude Recall is designed to be hackable:

- **Small Codebase**: Intentionally kept under 3000 lines
- **Clean Architecture**: Easy to understand and modify
- **Well Tested**: Comprehensive test coverage

## License

MIT - Use it, modify it, make it yours.

## The Future

Claude Recall is part of a larger vision where AI assistants truly understand and remember their users. By building on open protocols like MCP, we're creating a future where your AI tools work together seamlessly, with memory and context that persists across sessions, projects, and time.

Start building with memory. Start building with Claude Recall.

---

Built with ❤️ by developers who were tired of repeating themselves to Claude.