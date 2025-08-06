# Claude Recall Architecture

## Overview

Claude Recall is a multi-layered system that provides persistent memory for Claude through automatic capture, intelligent storage, and contextual retrieval. The architecture combines event-driven processing, protocol communication, and local storage to create a seamless memory experience.

## Core Components

### 1. Hook System
The hook system serves as the primary event capture mechanism, intercepting interactions between the user and Claude.

**Purpose**: Capture user prompts and tool usage events at the system level before they reach Claude.

**Key Mechanisms**:
- Lightweight shell scripts triggered by Claude Code events
- Minimal overhead (35-line scripts) to avoid performance impact
- Events are immediately queued rather than processed synchronously
- Two primary hooks: user-prompt and tool-use

**Flow**: User action → Hook trigger → Event capture → Queue insertion → Async processing

### 2. MCP Server
The Model Context Protocol server provides the communication interface between Claude and the memory system.

**Purpose**: Enable Claude to directly interact with the memory system through standardized protocol operations.

**Key Mechanisms**:
- STDIO transport for bidirectional communication
- Tool registration for memory operations (store, search, retrieve, stats)
- Session management to track conversation context
- Rate limiting to prevent abuse
- Middleware layer for automatic memory capture

**Flow**: Claude request → MCP server → Tool execution → Memory service → Response

### 3. Queue System
A SQLite-based queue implementation that decouples event capture from processing, ensuring system responsiveness.

**Purpose**: Buffer and prioritize events for asynchronous processing while maintaining order and reliability.

**Key Mechanisms**:
- Multiple named queues for different event types (hook-events, mcp-operations, memory-extraction)
- Priority-based message ordering with FIFO for same priority
- Automatic retry with exponential backoff for failed messages
- Dead letter queue for persistent failures
- Processor pool for concurrent message handling
- Transaction-based operations for consistency

**Flow**: Event arrival → Queue insertion → Processor pickup → Processing → Status update → Cleanup

### 4. Memory Service
The core intelligence layer that manages memory storage, retrieval, and relevance scoring.

**Purpose**: Store, organize, and intelligently retrieve memories based on semantic relevance and context.

**Key Mechanisms**:
- Semantic similarity scoring using text analysis
- Memory categorization by type (preferences, corrections, project_knowledge, tool_use, context)
- Project-based isolation while maintaining cross-project learning
- Relevance scoring based on recency, frequency, and context
- Memory enhancement with metadata and embeddings
- Pattern detection for identifying user preferences

**Flow**: Raw input → Pattern extraction → Enhancement → Storage → Indexing → Retrieval scoring

### 5. Storage Layer
SQLite database providing persistent, efficient local storage with automatic management.

**Purpose**: Reliable, fast, local-first storage that respects user privacy while preventing disk bloat.

**Key Mechanisms**:
- Single database file for all memories
- Optimized indexes for fast retrieval
- Full-text search capabilities
- Automatic vacuuming and optimization
- Memory lifecycle management
- Transactional integrity

**Structure**: memories table, queue_messages table, queue_configs table, dead_letter_queue table

## System Interactions

### Automatic Memory Capture Flow
1. User submits prompt to Claude
2. Hook intercepts the prompt event
3. Event is queued in hook-events queue
4. Queue processor picks up the event
5. Memory service extracts preferences and patterns
6. Relevant existing memories are searched
7. Memories are stored with appropriate metadata
8. Search results are injected into Claude's context

### Direct Memory Operations Flow
1. Claude invokes MCP tool (e.g., store_memory)
2. MCP server validates and routes request
3. Memory service processes the operation
4. Result returned through MCP protocol
5. Claude receives confirmation

### Restart Continuity Flow
1. System detects Claude Code restart via PID tracking
2. Previous session state loaded from continuity file
3. Pending operations resumed from checkpoint
4. Test scenarios continued from last known state
5. Memory context re-injected for seamless continuation

## Data Flow Patterns

### Write Path
User Input → Hook Capture → Queue → Processor → Pattern Detection → Enhancement → Storage

### Read Path
User Query → Hook Capture → Queue → Processor → Semantic Search → Relevance Scoring → Context Injection

### Feedback Loop
Retrieved Memories → Claude Response → User Feedback → Correction Capture → Memory Update

## Scalability Considerations

### Performance Optimizations
- Asynchronous processing prevents blocking
- Queue batching reduces database operations
- Indexed searches for sub-millisecond retrieval
- Memory pooling to reuse connections
- Lazy loading of large memory content

### Reliability Features
- Transactional queue operations
- Automatic retry with backoff
- Dead letter queue for investigation
- Checkpoint system for recovery
- State persistence across restarts

### Privacy & Security
- All data stored locally in user's home directory
- No network calls or telemetry
- File permissions restrict access
- No encryption (user can inspect their data)
- Complete user control over data lifecycle

## Extension Points

### Custom Processors
Queue processors can be extended to handle new event types or implement custom logic for memory extraction.

### Pattern Configuration
Memory patterns are configurable through JSON files, allowing customization of what gets captured automatically.

### Tool Extensions
New MCP tools can be added to provide additional memory operations without modifying core systems.

### Storage Adapters
While currently SQLite-only, the architecture supports alternative storage backends through the service layer abstraction.

## System Boundaries

### What the System Does
- Captures interaction patterns automatically
- Stores preferences and corrections
- Provides contextual memory retrieval
- Maintains continuity across sessions
- Manages memory lifecycle

### What the System Doesn't Do
- No cloud synchronization
- No sharing between users
- No machine learning model training
- No semantic embeddings (uses text similarity)
- No cross-device sync

## Operational Characteristics

### Startup Sequence
1. Database initialization and migration
2. Queue system initialization
3. Processor pool startup
4. MCP server registration
5. Hook verification
6. Continuity state recovery

### Shutdown Sequence
1. Stop accepting new events
2. Process remaining queue messages
3. Checkpoint current state
4. Close database connections
5. Clean up PID files

### Health Monitoring
- Queue depth monitoring
- Processing rate tracking
- Memory usage statistics
- Database size monitoring
- Error rate tracking

This architecture provides a robust, privacy-respecting memory system that enhances Claude's capabilities while remaining transparent and under user control.