# Stage 7: Critical Architecture Refactor Instructions

## 🚨 CRITICAL FINDING
We discovered why claude-recall's hooks are fragile while claude-flow's are robust:
- **Claude-Recall**: Puts ALL logic in hook scripts (monolithic)
- **Claude-Flow**: Uses hooks as simple triggers to a service layer (microservice)

This architectural mismatch is the root cause of all brittleness issues.

## 🎯 OBJECTIVE
Refactor claude-recall to use claude-flow's proven service layer pattern while removing all unnecessary complexity.

## 📋 IMPLEMENTATION TASKS

### Task 1: Create CLI Service Layer
Build a new `claude-recall` CLI that acts as the service layer:

```bash
# Create CLI entry point
src/cli/index.ts

# Commands to implement:
claude-recall capture pre-tool    # Handle pre-tool events
claude-recall capture post-tool   # Handle post-tool events  
claude-recall capture user-prompt # Handle user prompts
claude-recall retrieve <context>  # Retrieve relevant memories
claude-recall stats              # Show memory statistics
```

The CLI should:
- Accept piped input from hooks
- Handle all database operations
- Perform memory retrieval and scoring
- Format output for Claude Code
- Use `commander` or similar for CLI structure

### Task 2: Refactor Hooks to Simple Triggers
Replace current monolithic hook scripts with minimal triggers:

```javascript
// src/hooks/pre-tool-trigger.js
#!/usr/bin/env node
const { exec } = require('child_process');
let input = '';

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  const child = exec('npx claude-recall capture pre-tool');
  child.stdin.write(input);
  child.stdin.end();
  
  // Always exit 0 - let service handle errors
  child.on('close', () => process.exit(0));
});
```

Create similar minimal triggers for:
- `post-tool-trigger.js`
- `user-prompt-trigger.js`

### Task 3: Update Hook Configuration
Change `.claude/settings.json` from hardcoded paths to CLI commands:

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

### Task 4: Move Business Logic to Service
Extract all logic from current hook scripts into service modules:

```
src/
├── cli/
│   └── index.ts           # CLI entry point
├── services/
│   ├── capture.service.ts  # Handle event capture
│   ├── storage.service.ts  # Database operations
│   ├── retrieval.service.ts # Memory retrieval
│   └── format.service.ts   # Output formatting
├── hooks/                  # Minimal trigger scripts
│   ├── pre-tool-trigger.js
│   ├── post-tool-trigger.js
│   └── user-prompt-trigger.js
└── core/                   # Keep existing core logic
    ├── storage.ts
    ├── retrieval.ts
    └── patterns.ts
```

### Task 5: Package Configuration
Update `package.json`:

```json
{
  "name": "claude-recall",
  "version": "1.0.0",
  "bin": {
    "claude-recall": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc && chmod +x dist/cli/index.js",
    "postinstall": "npm run build"
  }
}
```

### Task 6: Clean Up
1. Delete all claude-flow reference documents in `docs/`
2. Remove authentication system (Stage 5) - not needed for local tool
3. Remove unused test files and scripts
4. Consolidate duplicate hook versions

### Task 7: Create Simple Documentation
Write a single `README.md` that explains:
- What claude-recall actually does (memory for Claude Code)
- How to install (`npm install -g`)
- How the service layer pattern works
- Why hooks must be simple triggers

## 🎯 SUCCESS CRITERIA
1. Hooks contain NO business logic - just call CLI
2. No hardcoded paths anywhere
3. Works with `npx claude-recall` from any directory
4. Total codebase under 1500 lines
5. Clear separation: hooks → CLI → service → storage

## ⚡ PRIORITY ORDER
1. Create CLI service layer first
2. Test CLI commands manually
3. Create minimal hook triggers
4. Update configuration
5. Test full integration
6. Clean up and document

## 🚫 WHAT NOT TO DO
- Don't try to integrate with claude-flow
- Don't add new features during refactor
- Don't keep complex architecture documents
- Don't use template variables or exit codes for control

## 💡 KEY INSIGHT
The entire problem stems from putting business logic in hooks. Claude-flow succeeded by keeping hooks dumb and services smart. Follow this pattern religiously.