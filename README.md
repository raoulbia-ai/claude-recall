# Claude Recall

An MCP server that gives Claude persistent memory across conversations.

Every time you start a new conversation with Claude, you're starting from scratch. Claude doesn't remember your preferences, your project context, or the decisions you've made together. Until now.

**Claude Recall** is an MCP (Model Context Protocol) server that gives Claude persistent memory across conversations. It learns from your interactions and provides relevant context in future conversations, making Claude feel like a true collaborator who remembers your journey together.

## Key Features

### 🧠 Automatic Memory System
- **No manual commands needed** - Claude automatically searches for relevant memories based on your prompts
- **Context-aware** - Retrieves memories that are semantically related to your current conversation
- **Persistent across restarts** - Your preferences and context survive Claude Code restarts

### 📝 Intelligent Capture
- **Automatic extraction** - Captures preferences, patterns, and important information from conversations
- **Categorized storage** - Organizes memories by type (preferences, project knowledge, corrections)
- **Priority-based** - More important or frequently used memories are prioritized

### 🔒 Privacy & Security First
- **100% Local** - All memories stored locally in SQLite (~/.claude-recall/)
- **No cloud sync** - Your data never leaves your machine
- **You own your data** - Export, view, or delete memories at any time
- **Zero telemetry** - No data collection or phone-home behavior
- **Security Audited** - Reviewed by Claude Code using `/security-review` command: No exposed secrets, SQL injection protection, 0 npm vulnerabilities

## Quick Start

### Option 1: Local Project Installation (Recommended)
For automatic CLAUDE.md integration in your project:
```bash
cd your-project
npm install claude-recall
```
This automatically adds Claude Recall instructions to your project's CLAUDE.md file.

### Option 2: Global Installation
For CLI access from anywhere:
```bash
npm install -g claude-recall@latest
```

**Note:** You can have both installations. For global installations, manually add this to your `~/.claude/CLAUDE.md`:
```markdown
## Claude Recall Integration
- IMPORTANT: Always search memories before creating new files or making decisions
- Use `mcp__claude-recall__search_memory` to check for stored preferences and project knowledge
- Memories include: coding preferences, file locations, project patterns, and team conventions
```

After installation, verify with: `claude-recall --version` (or `npx claude-recall --version` for local installs)

## How It Works

When you chat with Claude, the system:
1. **Captures** your preferences and important information
2. **Stores** them locally in SQLite (`~/.claude-recall/claude-recall.db`)
3. **Retrieves** relevant memories when you start new conversations
4. **Injects** context so Claude remembers your preferences

### Example
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

### Essential Commands
```bash
# View statistics
claude-recall stats

# Search memories
claude-recall search "database configuration"

# Export memories
claude-recall export memories.json

# Import memories
claude-recall import memories.json

# Clear memories (use with caution)
claude-recall clear --type preferences  # Clear only preferences
claude-recall clear --force               # Clear everything

# Test memory capture (for debugging)
claude-recall capture user-prompt '{"content":"your message here"}'
```

## Memory Management

Claude Recall automatically manages memory to prevent unlimited database growth, with user notifications:

### Current Limits
- **Maximum memories**: 10,000 total (configurable)
- **Database size threshold**: 10MB for automatic compaction
- **Queue message retention**: 7 days for completed messages

### User Notifications
- **Stats command** shows current usage: `8,234/10,000 (82.3%)`
- **Warning at 80%**: "⚠️ Note: Memory usage is high"
- **Critical at 90%**: "⚠️ WARNING: Approaching memory limit - pruning will occur soon"
- **During pruning**: "🔄 Pruned 500 old tool-use memories"
- **During compaction**: "🗜️ Compacting database... ✅ saved 2.3MB"

### Memory Retention by Type
- **Preferences**: Kept indefinitely (your coding style, tool choices)
- **Project Knowledge**: Kept indefinitely (database configs, API patterns)
- **Tool Usage**: Last 1,000 entries
- **Corrections**: Last 100 entries
- **Session memories**: Maximum 50 per session

### Manual Management
```bash
# Check database size and memory count (with usage percentage)
claude-recall stats

# Clear old memories
claude-recall clear --days 30        # Clear memories older than 30 days
claude-recall clear --type tool_use  # Clear specific type
claude-recall clear --all            # Clear everything (requires confirmation)

# Export before clearing
claude-recall export backup.json
```

### Environment Variables
```bash
# Customize limits
export CLAUDE_RECALL_MAX_MEMORIES=20000        # Increase memory limit
export CLAUDE_RECALL_COMPACT_THRESHOLD=20971520 # 20MB compaction threshold
export CLAUDE_RECALL_RETAIN_TOOL_USE=2000      # Keep more tool usage history
```

## Troubleshooting

### Memories not being retrieved?
1. Verify memories exist: `claude-recall stats`
2. Search manually to test: `claude-recall search "your topic"`

### Installation shows old version?

#### For global installation (CLI usage):
```bash
npm cache clean --force
npm uninstall -g claude-recall
npm install -g claude-recall@latest
claude-recall --version
```

#### For local installation (CLAUDE.md integration):
```bash
npm cache clean --force
npm uninstall claude-recall
npm install claude-recall@latest
npx claude-recall --version
```

### Performance issues?
- Check database size: `ls -lh ~/.claude-recall/claude-recall.db`
- Clear old memories: `claude-recall clear --days 30`
- The system uses SQLite with optimized indexes for fast retrieval

### Need Help?
Run this diagnostic script and share the output:
```bash
claude-recall --version
claude-recall stats
ls -lh ~/.claude-recall/claude-recall.db
node --version
npm --version
```

## Best Practices

1. **Be explicit about preferences** - Clear statements like "Always use..." or "Never..." are captured better
2. **Correct mistakes** - When Claude gets something wrong, the correction is remembered
3. **Review periodically** - Use `claude-recall stats` to see what's being remembered
4. **Export important memories** - Backup critical preferences with `claude-recall export`

## Acknowledgements

This project makes extensive use of the excellent work from:
- [claude-flow](https://github.com/ruvnet/claude-flow) - by Ruvnet

## License

MIT - Use it, modify it, make it yours.

## Disclaimer

This software is provided "as-is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and noninfringement. In no event shall the authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise, arising from, out of or in connection with the software or the use or other dealings in the software.

This project is provided for free to the community. While every effort has been made to ensure quality and security (including automated security reviews), users should review and test the code according to their own requirements before use in production environments.

---

Built with ❤️ by a developer who was tired of repeating himself to Claude.
