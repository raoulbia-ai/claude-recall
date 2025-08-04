# Stage 7 Implementation Request for Claude-Flow Swarm

## Context
I have a working memory system for Claude Code called "claude-recall" that captures tool usage and user preferences. It works but has a fragile architecture that needs refactoring to match claude-flow's robust service layer pattern.

## Current State
- **Working Features**: Memory capture, SQLite storage, pattern recognition, preference extraction, context-aware retrieval
- **Problem**: All logic is in hook scripts (monolithic), making them brittle with hardcoded paths
- **Solution**: Adopt claude-flow's pattern where hooks are simple triggers that call a CLI service

## What I Need You to Implement

### 1. Complete the CLI Service Layer
I've started a CLI at `src/cli/claude-recall-cli.ts`. Please:
- Ensure it works as a proper npm binary (`npx claude-recall`)
- Commands needed: `capture pre-tool`, `capture post-tool`, `capture user-prompt`, `stats`, `search`
- The CLI should handle all business logic that's currently in the hook scripts

### 2. Create Simple Hook Triggers
Replace the complex hooks in `src/hooks/` with minimal triggers:
```javascript
// Example: pre-tool-trigger.js
#!/usr/bin/env node
const { exec } = require('child_process');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const child = exec('npx claude-recall capture pre-tool');
  child.stdin.write(input);
  child.stdin.end();
  child.on('close', () => process.exit(0));
});
```

### 3. Update Configuration
Change `.claude/settings.json` to use CLI commands instead of file paths:
```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "npx claude-recall capture pre-tool"
      }]
    }]
    // ... similar for PostToolUse and UserPromptSubmit
  }
}
```

### 4. Clean Up Architecture
- Remove the authentication system (Stage 5) - not needed for local tool
- Delete all claude-flow integration documents
- Consolidate duplicate hook implementations
- Ensure no hardcoded paths remain

### 5. Package for Distribution
- Update `package.json` with proper bin configuration
- Ensure `npm install -g claude-recall` works
- Test that `npx claude-recall` works from any directory

## Success Criteria
1. **Hooks are dumb**: They only pipe data to CLI, contain no business logic
2. **No hardcoded paths**: Everything uses relative paths or CLI commands
3. **Clean codebase**: Under 1500 lines total
4. **Works globally**: Can run `npx claude-recall` from anywhere
5. **Maintains functionality**: All current features still work

## Important Files to Review
- `src/cli/claude-recall-cli.ts` - Existing CLI implementation
- `src/hooks/pre-tool-enhanced.ts` - Current complex hook (needs simplification)
- `src/services/` - Service layer already started
- `STAGE7_INSTRUCTIONS.md` - Detailed technical requirements
- `docs/implementation-tracker.md` - Full project history and context

## What NOT to Do
- Don't add new features during refactor
- Don't try to integrate with claude-flow (just adopt the pattern)
- Don't use environment variables in hooks (only in service layer)
- Don't worry about backwards compatibility

## Expected Outcome
A clean, maintainable memory system for Claude Code that:
- Captures tool usage and user preferences
- Retrieves relevant memories based on context
- Uses a robust service layer architecture
- Can be installed and used globally with npm

Please implement Stage 7 following these guidelines. The core functionality already works - this is purely an architectural refactor to make it production-ready.