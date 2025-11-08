# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.3.0]: https://github.com/genaisolutions/claude-recall/compare/v0.2.19...v0.3.0
