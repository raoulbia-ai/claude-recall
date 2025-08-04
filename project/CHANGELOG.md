# Changelog

## [0.1.2] - 2024-11-04

### Fixed
- Critical bug: Hooks not being triggered by Claude Code
- Changed hook configuration to use direct `npx` commands instead of file paths
- Added support for both lowercase and capitalized hook names for compatibility
- Installer now sets up hooks in a format Claude Code can execute

### Changed
- Hook configuration now uses `npx claude-recall capture` commands directly
- Added fallback support for multiple Claude Code hook naming conventions

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