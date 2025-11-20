# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.8] - 2025-11-17

### Added
- **Automatic memory search enforcement** via Claude Code hooks
- Pre-action search enforcer (`pre_tool_search_enforcer.py`) blocks Write/Edit until memory search performed
- User prompt capture hook (`user_prompt_capture.py`) for preference extraction
- Hook scripts auto-installed to `.claude/hooks/` during `npm install`
- Hook configuration auto-added to `.claude/settings.json`
- Session-aware blocking (one search covers multiple subsequent operations)
- New CLI commands:
  - `claude-recall recent-tools --session <id>`: Check if search performed in session
  - `claude-recall capture-prompt --session <id> --content <text>`: Store prompt for processing

### Changed
- Hook enforcement is now standard behavior (can be disabled in `.claude/settings.json`)
- Installation process now includes hook setup (scripts copied and configured automatically)

### Technical Details
- Hooks use Python 3 (pre-installed on most systems)
- Scripts read JSON from stdin (Claude Code hooks protocol)
- Exit code 2 blocks tool execution with educational error message
- Integrated with existing queue/MCP infrastructure

## [0.7.7] - 2025-11-17

### Removed
- **Pattern-analysis memory types** (pattern-analysis, detected-pattern, response-pattern)
- These were system-generated metadata that provided no retrieval utility

### Changed
- Pattern detection logic remains active for PreferenceExtractor
- No code retrieves or uses pattern-analysis memories
- Ranked lowest in relevance scoring

### Migration
Optional cleanup for users upgrading from earlier versions:

```bash
# Remove pattern-analysis memories
npx claude-recall clear --type pattern-analysis --force

# Remove detected-pattern memories
npx claude-recall clear --type detected-pattern --force

# Remove response-pattern memories
npx claude-recall clear --type response-pattern --force
```

**Note:** This cleanup is optional. These memory types are harmless but take up space.

## [0.7.6] - 2025-11-17

### Added
- **Automatic database schema migration**
- Missing columns auto-added on first command after upgrade
- `npx claude-recall migrate schema` command for manual migration
- Console messages during automatic migration:
  ```
  📋 Migrating database schema: Adding scope column...
  ✅ Added scope column
  ```

### Changed
- Added `sophistication_level` column (retroactive from v0.7.0)
- Added `scope` column (retroactive from v0.7.2)
- Database schema now self-healing on upgrades

### Migration

**Automatic Migration:**
The first time you run any command after upgrading to v0.7.6+, missing columns will be added automatically.

**Manual Migration (Optional):**
```bash
# Check current schema and migrate if needed
npx claude-recall migrate schema

# Create backup before migration
npx claude-recall migrate schema --backup
```

**Troubleshooting Schema Errors:**
If you see errors like `"no such column: scope"` or `"no such column: sophistication_level"`:

```bash
npx claude-recall migrate schema --backup
```

This will:
1. Create a backup of your database (if `--backup` flag used)
2. Add any missing columns
3. Create necessary indexes
4. Verify the migration succeeded

## [0.7.5] - 2025-11-17

### Added
- **Project registry** tracking all projects using Claude Recall
- Auto-registration when MCP server starts or during `npm install`
- Registry stored at `~/.claude-recall/projects.json`
- New CLI commands:
  - `claude-recall project list`: Show all registered projects
  - `claude-recall project show`: Show current project details
  - `claude-recall project register`: Manually register project
  - `claude-recall project unregister`: Remove project from registry
  - `claude-recall project clean`: Remove projects not seen in 30+ days

### Changed
- MCP server auto-registers project on startup
- Postinstall script registers project during installation
- Project status tracked (Active/Inactive based on MCP server state)

## [0.7.4] - 2025-11-17

### Added
- **MCP process management** via ProcessManager service
- PID file tracking in `~/.claude-recall/pids/mcp-{projectId}.pid`
- Cross-platform process validation using `process.kill(pid, 0)`
- Project-scoped process tracking (one server per project)
- Auto-cleanup of stale PID files on server start
- New CLI commands:
  - `claude-recall mcp status`: Show current project's server status
  - `claude-recall mcp ps`: List all running servers
  - `claude-recall mcp stop [--project X] [--force]`: Stop server
  - `claude-recall mcp restart [--force]`: Restart server
  - `claude-recall mcp cleanup [--dry-run] [--all]`: Clean up stale processes
- `CLAUDE_RECALL_AUTO_CLEANUP` environment variable for automatic cleanup

### Fixed
- MCP server accumulation (multiple servers running for same project)
- Zombie process cleanup and detection
- "MCP server already running" errors

## [0.7.2] - 2025-11-17

### Added
- **Project-specific memory scoping**
- Three memory scopes:
  - **Universal** (`scope='universal'`): Available in all projects
  - **Project** (`scope='project'`): Only available in current project
  - **Unscoped** (`scope=null`, default): Available everywhere (backward compatible)
- Auto-detection from user language:
  - Universal indicators: "remember everywhere", "for all projects", "globally"
  - Project indicators: "for this project", "project-specific", "only here"
- CLI flags for scope control:
  - `--global`: Search/show memories from all projects
  - `--project <id>`: Search/show memories for specific project

### Changed
- Default search behavior: Current project + universal + unscoped memories
- Stats command shows project-specific statistics by default
- Search command respects project scoping

## [0.7.0] - 2025-11-17

### Added
- **Intelligence & Evolution tracking**
- Automatic failure learning with counterfactual reasoning:
  - What failed
  - Why it failed
  - What should be done instead
  - Preventative checks for future
- Sophistication classification (L1-L4):
  - L1 Procedural: Basic tool use, simple actions
  - L2 Self-Reflection: Error checking, corrections, learning from failures
  - L3 Adaptive: Systematic workflows, devops patterns
  - L4 Compositional: Multi-constraint reasoning, complex decision-making
- New CLI commands:
  - `claude-recall evolution [--days N] [--project X]`: View progression metrics
  - `claude-recall failures [--limit N] [--project X]`: View failures with counterfactual learning
- Progression score tracking (0-100)
- Confidence trends (improving/stable/declining)
- Failure rate trends

### Changed
- All memories automatically classified by sophistication level
- Rich Title/Description/Content format for better readability
- FailureExtractor captures failures automatically from error messages and user corrections

## [0.5.0] - 2025-11-17

### Added
- **Claude Code Skills integration**
- Memory management skill at `.claude/skills/memory-management/SKILL.md`
- DevOps memory type (highest priority):
  - Build/deploy patterns
  - Git workflow conventions
  - Testing preferences
  - Project architecture
  - CI/CD configurations
- Progressive disclosure for workflow instructions
- Skills auto-created during `npm install`

### Changed
- Memory type hierarchy now prioritizes DevOps patterns
- Relevance scoring favors DevOps over tool-use memories

## [0.3.0] - 2025-10-14

### Added

#### Phase 1: MCP Protocol Enhancement
- **MCP Resources support** - Expose memories as subscribable resources
  - `claude-recall://preferences/all` - All user coding preferences
  - `claude-recall://context/active` - Top 5 most relevant memories from last 24 hours
- **MCP Prompts support** - 5 prompt templates with memory context pre-injected
  - `with-preferences` - Auto-inject all coding preferences
  - `with-project-context` - Inject project knowledge (optional topic filter)
  - `with-corrections` - Inject recent corrections to avoid mistakes
  - `with-full-context` - Search and inject relevant memories for specific task
  - `analyze-for-preferences` - Ask Claude Code to analyze conversation and extract preferences
- New handlers: `ResourcesHandler` (src/mcp/resources-handler.ts:454) and `PromptsHandler` (src/mcp/prompts-handler.ts:495)

#### Phase 2: Automatic Intelligence
- **Automatic preference detection** - Detects preference signals in conversations
  - Keyword detection: "prefer", "always", "never", "use", "avoid", etc.
  - Tracks preference signals across conversation turns
- **Automatic analysis triggers** - Suggests analysis after:
  - 5 unanalyzed conversation turns, OR
  - 3 turns with preference signals
- **Conversation tracking** - Enhanced SessionManager tracks last 50 turns per session
- **Batch preference storage** - New `store_preferences` tool for storing multiple preferences at once
- New service: `PreferenceAnalyzer` (src/services/preference-analyzer.ts:315)

#### Phase 3: Proactive Intelligence
- **Context-aware tool descriptions** - Tool descriptions dynamically enhanced with relevant memories
  - Example: `create_file` tool shows "📝 Remember: User prefers TypeScript"
  - Filters memories by relevance threshold (0.7+ confidence)
  - Limits to top 3 memories per tool
- **Proactive memory injection** - Memories automatically injected before tool execution
  - Keyword extraction from tool inputs
  - Top 3 relevant memories added to `_memoryContext` field
  - Works automatically without explicit search
- **Memory usage tracking** - Tracks which memories are actually useful
  - Boosts relevance for effective memories (used >70% of time)
  - Reduces relevance for ignored memories (used <30% of time)
  - Provides effectiveness statistics
- New services:
  - `ContextEnhancer` (src/services/context-enhancer.ts:289)
  - `KeywordExtractor` (src/services/keyword-extractor.ts:218)
  - `MemoryUsageTracker` (src/services/memory-usage-tracker.ts:309)

#### Phase 4: Conversation Context Awareness
- **Duplicate request detection** - Detects when user asks the same question multiple times
  - Configurable detection window (default: 3 turns)
  - Normalizes action keys for consistent matching
  - Returns previous results with helpful suggestions
- **Context-aware suggestions** - Generates helpful responses when duplicates detected
  - Example: "I just performed this exact action in my previous response. Did you want me to re-analyze with different criteria?"
- **Session cleanup** - Automatic cleanup of old sessions (30 minute timeout)
- **Health monitoring** - Conversation context stats added to health check endpoint
- New service: `ConversationContextManager` (src/services/conversation-context-manager.ts:361)
- Comprehensive test coverage: 20 passing unit tests

### Changed

- Enhanced `MCPServer` to support Resources and Prompts protocols (src/mcp/server.ts)
- Modified `SessionManager` to track conversation history with preference signals
- Enhanced `MemoryCaptureMiddleware` with proactive memory injection
- Updated `handleToolsList` to inject memories into tool descriptions
- Updated `handleToolCall` to check for duplicates and inject memories
- Health check endpoint now includes conversation context statistics

### Fixed

- Improved real-time intelligence - system now proactively retrieves memories without explicit search
- Better capture rate for user preferences through multi-pass analysis
- Reduced user corrections needed through proactive context injection

## [0.2.19] - Previous Release

Earlier versions focused on basic MCP server functionality, memory storage, and CLI tools.

---

[0.7.8]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.7...v0.7.8
[0.7.7]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.5...v0.7.6
[0.7.5]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.4...v0.7.5
[0.7.4]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.2...v0.7.4
[0.7.2]: https://github.com/raoulbia-ai/claude-recall/compare/v0.7.0...v0.7.2
[0.7.0]: https://github.com/raoulbia-ai/claude-recall/compare/v0.5.0...v0.7.0
[0.5.0]: https://github.com/raoulbia-ai/claude-recall/compare/v0.3.0...v0.5.0
[0.3.0]: https://github.com/raoulbia-ai/claude-recall/compare/v0.2.19...v0.3.0
