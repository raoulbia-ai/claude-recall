# Claude Recall User Guide

## What is Claude Recall?

Claude Recall is an intelligent memory system for Claude that automatically captures and retrieves relevant context from your conversations. It works seamlessly in the background to give Claude persistent memory across sessions.

## Key Features

### 🧠 Automatic Memory Retrieval
- **No manual commands needed** - Claude automatically searches for relevant memories based on your prompts
- **Context-aware** - Retrieves memories that are semantically related to your current conversation
- **Persistent across restarts** - Your preferences and context survive Claude Code restarts

### 📝 Intelligent Memory Capture
- **Automatic extraction** - Captures preferences, patterns, and important information from conversations
- **Categorized storage** - Organizes memories by type (preferences, project knowledge, corrections)
- **Priority-based** - More important or frequently used memories are prioritized

## Installation

### Install via npm
```bash
npm install -g claude-recall@latest
```

### Verify Installation
```bash
claude-recall --version  # Should show 0.2.12 or higher
```

## How It Works

### Automatic Mode (Default)
When you chat with Claude, the system:
1. **Captures** your preferences and important information automatically
2. **Stores** them in a local SQLite database (~/.claude-recall/)
3. **Retrieves** relevant memories when you start new conversations
4. **Injects** context so Claude remembers your preferences

### Example Workflow
```
You: "I prefer TypeScript with strict mode for all my projects"
[Claude Recall automatically stores this preference]

--- Later, in a new session ---

You: "Create a new module for user authentication"
[Claude Recall retrieves your TypeScript preference]
Claude: "I'll create a TypeScript module with strict mode enabled..."
```

## Memory Types

### Preferences
- Coding style preferences (languages, frameworks, patterns)
- Tool preferences (testing frameworks, build tools)
- Workflow preferences (git conventions, file structures)

### Project Knowledge
- Database configurations
- API patterns and endpoints
- Architecture decisions
- Dependencies and versions

### Context
- Current tasks and work in progress
- Recent decisions and changes
- Team conventions

### Corrections
- Learned from mistakes
- Updated patterns
- Deprecated approaches to avoid

## CLI Commands

### Search Memories
```bash
claude-recall search "database configuration"
```

### View Statistics
```bash
claude-recall stats
```

### Export Memories
```bash
claude-recall export memories.json
```

### Clear Memories (use with caution)
```bash
claude-recall clear --type preferences  # Clear only preferences
claude-recall clear --all               # Clear everything
```

## Privacy & Storage

- **Local storage only** - All memories are stored locally in `~/.claude-recall/`
- **No cloud sync** - Your data never leaves your machine
- **User control** - You can view, export, or delete memories at any time
- **Gitignored by default** - Memory database is excluded from version control

## Troubleshooting

### Memories not being retrieved?
1. Check if claude-recall is installed: `claude-recall --version`
2. Verify memories exist: `claude-recall stats`
3. Search manually to test: `claude-recall search "your topic"`

### Too many irrelevant memories?
- Clear old memories: `claude-recall clear --days 30`
- Adjust relevance threshold in settings

### Performance issues?
- The system uses SQLite with optimized indexes
- Old memories are automatically cleaned up based on retention settings
- Check database size: `ls -lh ~/.claude-recall/claude-recall.db`

## Best Practices

1. **Be explicit about preferences** - Clear statements like "Always use..." or "Never..." are captured better
2. **Correct mistakes** - When Claude gets something wrong, the correction is remembered
3. **Review periodically** - Use `claude-recall stats` to see what's being remembered
4. **Export important memories** - Backup critical preferences with `claude-recall export`

## Version History

- **v0.2.12** - Automatic memory retrieval fully functional
- **v0.2.11** - Queue system improvements
- **v0.2.10** - Initial MCP integration

## Support

For issues or questions:
- GitHub: https://github.com/raoulbia-ai/claude-recall
- npm: https://www.npmjs.com/package/claude-recall

---
*Claude Recall - Giving Claude persistent, intelligent memory*