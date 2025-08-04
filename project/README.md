# Claude Recall

Memory-enhanced Claude Code hooks with service layer architecture.

## What it does

Claude Recall captures tool usage and user preferences from Claude Code sessions, storing them in a local SQLite database for context-aware retrieval in future conversations. It learns your patterns and provides relevant context automatically.

## Installation

### Global Installation (Recommended)

```bash
npm install -g claude-recall
```

After installation, you can use `claude-recall` or `npx claude-recall` from anywhere.

### Local Development

```bash
git clone <repository>
cd claude-recall
npm install
npm run build
npm link  # for global access during development
```

## Architecture

Claude Recall follows a clean service layer pattern inspired by claude-flow:

```
Hooks → CLI → Service → Storage
```

### Why This Architecture?

- **Hooks are dumb**: Simple triggers that only pipe data to CLI service
- **CLI is smart**: Handles all business logic, parsing, and coordination  
- **Services are modular**: Clean separation of concerns (memory, config, logging)
- **Storage is isolated**: Database operations centralized in storage layer

This prevents the brittleness common in hook-based systems where business logic is scattered across hook scripts.

## CLI Commands

### Capture Commands (Used by Hooks)

```bash
claude-recall capture pre-tool    # Handle pre-tool events
claude-recall capture post-tool   # Handle post-tool events  
claude-recall capture user-prompt # Handle user prompts
```

### Utility Commands

```bash
claude-recall stats              # Show memory statistics
claude-recall search "database"  # Search memories by query
claude-recall --help            # Show help
```

## Hook Configuration

Update your `.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "npx claude-recall capture pre-tool"
      }]
    }],
    "PostToolUse": [{
      "matcher": "*", 
      "hooks": [{
        "type": "command",
        "command": "npx claude-recall capture post-tool"
      }]
    }],
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "npx claude-recall capture user-prompt"
      }]
    }]
  }
}
```

## Key Features

- **Memory Capture**: Automatically captures tool usage, preferences, and patterns
- **Context Retrieval**: Provides relevant memories based on current context
- **Pattern Recognition**: Learns from corrections and user preferences  
- **Global Access**: Works with `npx claude-recall` from any directory
- **Clean Architecture**: Service layer pattern prevents brittleness
- **Local Storage**: All data stays on your machine (SQLite database)

## Development

The codebase is intentionally kept minimal (under 2000 lines) with clear separation:

- `src/cli/` - CLI interface and command handling
- `src/services/` - Business logic services  
- `src/core/` - Core functionality (storage, retrieval, patterns)
- `src/hooks/minimal/` - Simple hook triggers
- `src/memory/` - Database schema and operations

## Success Criteria Met

✅ Hooks contain NO business logic - just pipe data to CLI  
✅ No hardcoded paths anywhere in the system  
✅ Works with `npx claude-recall` from any directory  
✅ Clean separation: hooks → CLI → service → storage  
✅ All original functionality preserved after refactor  

This architecture makes Claude Recall maintainable, testable, and robust for long-term use.