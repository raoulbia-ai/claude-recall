# Claude Recall

A memory system for Claude Code that captures and recalls context from your development sessions.

## Overview

Claude Recall enhances Claude Code by providing persistent memory across sessions. It automatically captures:
- Tool usage patterns and preferences
- User commands and workflows
- Project-specific context and decisions

This allows Claude to remember your preferences and provide more contextual assistance over time.

## Features

- **Automatic Memory Capture**: Hooks into Claude Code to capture relevant interactions
- **Intelligent Retrieval**: Returns contextually relevant memories based on current queries
- **Pattern Detection**: Identifies recurring patterns in your development workflow
- **SQLite Storage**: Lightweight, local storage with no external dependencies
- **CLI Interface**: Simple commands for memory management and statistics

## Installation

### Prerequisites
- Node.js >= 16.0.0
- Claude Code CLI installed

### Install from npm
```bash
npm install -g claude-recall
```

### Install from source
```bash
git clone https://github.com/raoulbia-ai/claude-recall.git
cd claude-recall/project
npm install
npm run build
npm link
```

## Configuration

### Automatic Setup
During installation, Claude Recall will:
1. Create a `.claude/` directory in your home folder
2. Set up hooks in Claude's settings.json
3. Initialize the SQLite database

### Manual Setup
If automatic setup fails, you can manually configure by adding to your Claude settings.json:

```json
{
  "hooks": {
    "user-prompt-submit": "npx claude-recall capture user-prompt",
    "pre-tool": "npx claude-recall capture pre-tool",
    "post-tool": "npx claude-recall capture post-tool"
  }
}
```

## Usage

### CLI Commands

```bash
# View memory statistics
claude-recall stats

# Search memories
claude-recall search "database"

# Clear memories by type
claude-recall clear --type user-prompt
claude-recall clear --type tool-usage
claude-recall clear --all

# View status
claude-recall status
```

### How It Works

1. **Capture**: Hooks automatically capture interactions with Claude
2. **Process**: Patterns and preferences are extracted from captured data
3. **Store**: Information is stored in a local SQLite database
4. **Retrieve**: Relevant memories are injected into Claude's context when needed

## Memory Types

- **user-prompt**: User commands and queries
- **tool-usage**: Tool executions and parameters
- **preferences**: Detected user preferences and patterns
- **context**: Project-specific information

## Privacy

All data is stored locally on your machine. No information is sent to external servers.

## Troubleshooting

### Claude Code doesn't recognize memories
- Restart Claude Code after installation
- Verify hooks are properly configured: `claude-recall status`

### Database errors
- Check permissions: `~/.claude/claude-recall.db`
- Reinitialize: `claude-recall clear --all`

### Hook failures
- Ensure `npx` is in your PATH
- Check Claude's settings.json for proper hook configuration

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details

## Support

- Issues: https://github.com/raoulbia-ai/claude-recall/issues
- Documentation: https://github.com/raoulbia-ai/claude-recall/wiki