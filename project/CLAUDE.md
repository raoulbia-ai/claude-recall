# Claude Recall - Active Memory System

## Current Status
Claude-recall is fully operational with Stage 7 complete. The system captures all tool usage and user preferences, storing them in SQLite for future retrieval.

## Important Notes for Next Session
1. **Memory Injection is Fixed**: The CLI now outputs plain text instead of JSON, allowing memories to be injected into Claude's context
2. **Restart Required**: After any changes to hooks or CLI, Claude Code must be restarted for changes to take effect
3. **Current Memory Count**: 669+ memories stored and growing

## Quick Test
To verify memory injection is working:
```bash
echo '{"content":"what database do we use?"}' | npx claude-recall capture user-prompt
```

Should return memories about PostgreSQL usage.

## Key Information Stored
- This project uses PostgreSQL as the primary database
- Tests should be saved in tests-raoul/ directory (user preference)
- The system uses a service layer architecture with CLI commands
- All hooks are minimal triggers that call `npx claude-recall capture [type]`

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