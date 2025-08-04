# User Prompt Submit Hook Guide

## Overview

The `user-prompt-submit-hook` is a custom hook for Claude Code that captures user messages and extracts preferences and project knowledge. This allows Claude Recall to remember user preferences across sessions.

## Features

- **Preference Extraction**: Automatically identifies and stores user preferences from natural language
- **Pattern Recognition**: Supports multiple preference patterns
- **Memory Storage**: Saves preferences to SQLite database
- **Context Retrieval**: Provides relevant preferences when similar topics arise

## Supported Preference Patterns

### 1. Location Preferences
- `"tests should be saved in tests-raoul/"`
- `"save configuration files in config/"`
- `"put utility functions in utils folder"`
- `"components should be placed in src/components"`

### 2. Tool Preferences
- `"use pytest for testing Python code"`
- `"use ESLint for linting"`

### 3. Choice Preferences
- `"prefer TypeScript over JavaScript"`
- `"prefer tabs over spaces"`

### 4. Always/Never Rules
- `"always use ESLint for linting"`
- `"never commit directly to main branch"`

## Installation

1. **Compile the Hook**:
```bash
npx tsc src/hooks/user-prompt-submit-v2.ts --outDir dist --target es2020 --module commonjs --esModuleInterop --skipLibCheck
```

2. **Configure Claude Code**:
Copy the settings file with the user prompt hook:
```bash
cp .claude/settings-with-prompt-hook.json .claude/settings.json
```

3. **Restart Claude Code** to apply the new settings

## Usage

Once installed, the hook automatically captures user messages. No additional action is required.

### Example Conversations

**User**: "tests should be saved in tests-raoul/"
- Hook captures: `tests → tests-raoul/` as a location preference

**User**: "I prefer TypeScript over JavaScript for this project"
- Hook captures: `Prefer TypeScript over JavaScript` as a choice preference

**User**: "always run tests before committing"
- Hook captures: `Always run tests before committing` as an always rule

## Testing

Run the test script to verify preference extraction:
```bash
node test-preference-extraction-v2.js
```

## Implementation Details

### Hook Architecture
- **Type**: `UserPromptSubmit` - Triggered when user submits a message
- **Storage**: SQLite database (`claude-recall.db`)
- **Logging**: `user-prompt-capture.log`

### Memory Structure
```typescript
{
  key: "preference_location_preference_...",
  value: {
    type: "location_preference",
    description: "tests → tests-raoul/",
    raw: "tests should be saved in tests-raoul/"
  },
  type: "preference",
  project_id: "/current/project/path",
  timestamp: 1234567890,
  relevance_score: 1.0
}
```

### Integration with Retrieval
The hook integrates with the existing `MemoryRetrieval` system to:
1. Store preferences when detected
2. Retrieve relevant preferences based on context
3. Display preferences when relevant topics arise

## Troubleshooting

### Hook Not Triggering
1. Check that Claude Code supports `UserPromptSubmit` hooks
2. Verify the settings file is in `.claude/settings.json`
3. Check `user-prompt-capture.log` for errors

### Preferences Not Being Stored
1. Ensure the database file exists: `claude-recall.db`
2. Check file permissions
3. Review the log file for storage errors

### Preferences Not Retrieved
1. Verify preferences were stored correctly
2. Check that the query context matches stored preferences
3. Review relevance scoring in retrieval logic

## Future Enhancements

1. **More Pattern Types**:
   - Project structure preferences
   - Naming conventions
   - Code style preferences

2. **Smarter Retrieval**:
   - Context-aware preference suggestions
   - Preference conflict resolution
   - Time-based preference decay

3. **User Feedback**:
   - Confirmation of captured preferences
   - Ability to edit/remove preferences
   - Preference priority settings