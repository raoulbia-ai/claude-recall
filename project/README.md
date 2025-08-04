# Claude Recall

🧠 **Give Claude a memory that actually works.**

Ever wished Claude could remember that you prefer PostgreSQL over MySQL? Or that your tests go in `tests/`? Or that you always use pytest, not unittest?

Claude Recall makes this happen. It's a lightweight memory layer that captures your development patterns and preferences, then intelligently surfaces them both in your current session and future conversations.

## Why Claude Recall?

Claude doesn't naturally remember your preferences and patterns across different conversations. Even when resuming a conversation, it doesn't learn from what you've told it before.

Claude Recall solves this by building a persistent memory of how YOU work:

### 🔧 Tool Usage Patterns
**Without Claude Recall**: "Please use rg instead of grep" (every. single. time.)  
**With Claude Recall**: Claude automatically uses `rg` because it learned that's your preference

### 📝 User Preferences  
**Without Claude Recall**: "Put tests in the tests/ directory, not in src/"  
**With Claude Recall**: Claude knows where you want your tests and follows your structure

### 🎯 Workflow Patterns
**Without Claude Recall**: "Show me the diff before making changes"  
**With Claude Recall**: Claude learns to show diffs first because that's how you work

### 💡 Project Context
**Without Claude Recall**: "We use PostgreSQL for this project, not MySQL"  
**With Claude Recall**: Claude remembers your tech stack choices automatically

The magic? This happens automatically. Every correction you make, every preference you express - it all gets captured and remembered.

## Quick Start

### Prerequisites
- Node.js >= 16.0.0
- Claude Code CLI installed

### Install
```bash
npm install -g @genaisolutions/claude-recall
```

That's it! Claude Recall automatically configures itself during installation.

### Verify Installation
```bash
claude-recall validate
```

## Usage

### Core Commands

```bash
# View memory statistics
claude-recall stats

# Search memories
claude-recall search "database"
claude-recall search "python" --limit 10

# Check system status
claude-recall status
```

### Memory Management

```bash
# Clear specific memory types
claude-recall clear --type user-prompt
claude-recall clear --type tool-usage
claude-recall clear --type preferences

# Clear all memories
claude-recall clear --all

# List available memory types
claude-recall clear --list-types
```

## How It Works

1. **Capture**: Hooks automatically capture interactions with Claude
2. **Process**: Patterns and preferences are extracted from captured data
3. **Store**: Information is stored in a local SQLite database
4. **Retrieve**: Relevant memories are injected into Claude's context when needed

### Memory Types

- **user-prompt**: User commands and queries
- **tool-usage**: Tool executions and parameters
- **preferences**: Detected user preferences and patterns
- **context**: Project-specific information

## Installation Details

### Automatic Setup
During installation, Claude Recall will:
1. Create a `.claude/` directory in your home folder
2. Set up hooks in Claude's settings.json
3. Initialize the SQLite database

### Install from Source
```bash
git clone https://github.com/raoulbia-ai/claude-recall.git
cd claude-recall/project
npm install
npm run build
npm link
```

## Troubleshooting

### Claude Code doesn't recognize memories
- Restart Claude Code after installation
- Verify hooks are properly configured: `claude-recall status`

### Database errors
- Check permissions: `~/.claude/claude-recall.db`
- Reinitialize: `claude-recall clear --all`

### Hook failures
- Ensure `npx` is in your PATH
- Run `claude-recall validate` to check configuration

## Technical Details

### Architecture
The system uses Claude's hook system to capture events. The architecture follows a clean separation: Hooks → CLI → Services → Storage.

Hook configuration in settings.json:
```json
{
  "hooks": {
    "user-prompt-submit": "npx claude-recall capture user-prompt",
    "pre-tool": "npx claude-recall capture pre-tool",
    "post-tool": "npx claude-recall capture post-tool"
  }
}
```

### Hook Design

Claude Recall's architecture is inspired by [claude-flow](https://github.com/ruvnet/claude-flow)'s clean separation principle: hooks should be dumb, services should be smart.

Instead of putting logic in hook scripts, hooks are simple pipes:
```javascript
// Hook just pipes data to CLI - that's it!
process.stdin.pipe(
  spawn('npx', ['claude-recall', 'capture', 'user-prompt'])
);
```

This means:
- **Hooks never break**: They're too simple to fail
- **Logic stays centralized**: All intelligence lives in the service layer
- **Easy updates**: Update the service without touching hooks

### Memory Management

Claude Recall uses SQLite for efficient local storage:

- **Deduplication**: Similar memories are merged to avoid redundancy
- **Relevance scoring**: Memories are ranked by frequency and recency
- **Memory limits**: Default 10,000 memories with automatic cleanup
- **Performance**: Sub-millisecond retrieval, ~5ms hook overhead
- **Storage size**: Typically under 50MB even with heavy use

## Privacy

All data is stored locally on your machine. No information is sent to external servers.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see LICENSE file for details

## Support

- Issues: https://github.com/raoulbia-ai/claude-recall/issues
- Documentation: https://github.com/raoulbia-ai/claude-recall/wiki