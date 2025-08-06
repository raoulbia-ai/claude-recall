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
- **Restart Continuity**: Maintains state across Claude Code restarts for uninterrupted workflows
- **Live Testing**: AI-driven testing with automatic restart and recovery capabilities

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

Claude Recall uses the Model Context Protocol to integrate directly with Claude Code. 

### Automatic Memory System (v0.2.9+)

Claude Recall creates a seamless memory experience:
1. **Automatic Context Loading** - Claude searches memory on EVERY prompt to provide context-aware responses
2. **Silent Memory Storage** - Memories are stored without mentioning it
3. **Natural Integration** - Retrieved information is used as if Claude always knew it

**Memory storage is triggered by:**
- "recall" (when used for storing, e.g., "for recall later")
- "remember" / "remember that" / "please remember"
- "don't forget" / "keep in mind" / "bear in mind"
- "store in memory" / "save to memory"
- "note that" / "take note"
- "for future reference" / "memorize"

**Memory retrieval (using "recall") is triggered by:**
- "recall" / "recall what I said about"
- "what did I tell you about"
- "what do you remember about"
- "do you remember"

**Additional patterns detected automatically:**
- **Preferences**: "I prefer X over Y", "Always use X", "From now on, use Y"
- **Decisions**: "We decided to...", "Let's go with...", "We'll use..."
- **Instructions**: "Make sure to...", "Ensure that...", "Files should be in..."

### Manual Memory Storage

You can also explicitly ask Claude to store memories using the MCP tools:
- Use the `mcp__claude-recall__store_memory` tool
- Search with `mcp__claude-recall__search`
- Get stats with `mcp__claude-recall__get_stats`

## Real-World Example

```
Monday: "Remember: all tests go in the tests/ directory"
Claude: "Understood!" 

Tuesday: "Create a test for user authentication"
Claude: [automatically searches memory, finds test location preference]
"I'll create the authentication test in tests/auth.test.js"

Wednesday: "Where should tests go?"
Claude: "Tests go in the tests/ directory."
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

## Installation Details

The npm installation automatically:
- Installs the Claude Recall CLI globally
- Configures the MCP server in your `~/.claude.json` file
- Creates a database directory at `~/.claude-recall/`
- Updates `~/CLAUDE.md` with global instructions for Claude to use memory tools
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

## Restart Continuity & Live Testing (v0.2.11+)

Claude Recall now includes advanced restart continuity and live testing capabilities, ensuring your workflows continue seamlessly even when Claude Code needs to restart.

### Restart Continuity

Maintains state across Claude Code restarts:
- **Automatic Recovery**: Resumes interrupted tests and workflows after restart
- **Checkpoint System**: Save progress points for granular recovery
- **Session Tracking**: Preserves session context through restarts
- **Pending Actions**: Queues actions to be processed after restart

### Live Testing

AI-driven testing with automatic restart capability:
```bash
# Start live testing with auto-restart
claude-recall live-test start -s memory_persistence search_compliance

# Check status
claude-recall live-test status

# View continuity state
claude-recall live-test continuity
```

**Features:**
- **Auto-Restart on Changes**: Detects hook/CLI changes and restarts automatically
- **Test Recovery**: Resumes tests from last checkpoint after restart
- **Result Injection**: Test results stored as searchable memories
- **Configurable Policies**: Control restart behavior and limits

See [RESTART_CONTINUITY.md](docs/RESTART_CONTINUITY.md) for detailed documentation.

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

### Customizing Memory Patterns

Claude Recall uses configurable patterns for automatic memory capture. You can customize these by setting the `CLAUDE_RECALL_PATTERNS_CONFIG` environment variable to point to your own JSON configuration file.

Default patterns include:
- **Explicit remember**: Any sentence with "remember" (confidence: 1.0)
- **Preferences**: "I prefer", "Always use", "From now on" (confidence: 0.85-0.9)
- **Locations**: "Should be in X directory" (confidence: 0.8)
- **Instructions**: "Make sure", "Ensure that" (confidence: 0.7)

See `src/config/memory-patterns.json` for the full configuration format.

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

### Clearing npm Cache (Version Issues)

If you're seeing an old version after installing `@latest`, clear the npm cache:

```bash
# Complete cache clear and reinstall
npm uninstall -g claude-recall
npm cache clean --force
npm cache verify
npm install -g claude-recall@latest

# Verify the installation
claude-recall --version
claude-recall mcp test
```

### Diagnostic Commands for Support

If you need help troubleshooting, run these commands and share the output:

```bash
"""# 1. Check Installation
claude-recall --version
which claude-recall
npm list -g claude-recall

# 2. Check MCP Configuration
cat ~/.claude.json | grep -A10 "claude-recall"
claude-recall mcp test

# 3. Check Database
ls -la ~/.claude-recall/
ls -lh ~/.claude-recall/claude-recall.db 2>/dev/null || echo "Database not found"

# 4. Check System Status
claude-recall status
claude-recall stats

# 5. Test Basic Functionality
claude-recall search "test"
claude-recall stats | grep "Total memories"

# 6. Check for Errors
ls -la *.log 2>/dev/null || echo "No log files"
tail -20 info.log 2>/dev/null || echo "No info log"

# 7. Environment Info
node --version
npm --version
echo "OS: $(uname -s)"
echo "Home: $HOME""""
```

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