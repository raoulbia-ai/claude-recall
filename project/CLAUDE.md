# Claude Recall - Quick Reference

## Overview
Claude Recall captures tool usage and user preferences, storing them in SQLite for intelligent retrieval in future Claude sessions.

## Important Notes
1. **Restart Required**: After any changes to hooks or CLI, Claude Code must be restarted for changes to take effect
2. **Memory Storage**: All memories are stored locally in SQLite database

## Quick Test
To verify memory injection is working:
```bash
echo '{"content":"what database do we use?"}' | npx claude-recall capture user-prompt
```

Should return memories about PostgreSQL usage.

## What Gets Captured
- Tool usage patterns (which tools you use and how)
- User preferences (detected from your commands)
- Project context (technology choices, patterns)
- Command history (for workflow optimization)

## Architecture
- Hooks: Simple 35-line triggers in `src/hooks/minimal/`
- CLI: Main entry point at `src/cli/claude-recall-cli.ts`
- Services: Business logic in `src/services/`
- Storage: SQLite database at `claude-recall.db`

## Build Command
Always run after changes:
```bash
npm run build
```