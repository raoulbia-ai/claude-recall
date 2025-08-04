# Changelog

## [0.1.1] - 2024-11-04

### Fixed
- Critical bug: User prompts are now properly stored as memories
- The capture command now correctly saves user-prompt events to the database
- Memory retrieval now works as intended

### Changed
- Improved memory storage implementation in handleUserPromptSubmit

## [0.1.0] - 2024-11-04

### Initial Release
- Automatic memory capture from Claude Code sessions
- Pattern detection and preference learning
- SQLite-based local storage
- CLI commands for memory management
- Hook system integration with Claude Code