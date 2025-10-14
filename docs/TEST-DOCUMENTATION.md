# Test Suite Documentation

This document provides a comprehensive overview of the Claude Recall test suite, explaining what each test does and why it exists.

## Table of Contents

- [Overview](#overview)
- [Test Organization](#test-organization)
- [Unit Tests](#unit-tests)
- [Integration Tests](#integration-tests)
- [MCP Protocol Tests](#mcp-protocol-tests)
- [Experimental Tests](#experimental-tests)
- [Benchmarks](#benchmarks)
- [Quick Reference](#quick-reference)

---

## Overview

Claude Recall's test suite ensures the MCP server provides reliable, persistent memory for Claude Code. The tests verify:

1. **Data Integrity**: Memories are stored and retrieved correctly
2. **Smart Retrieval**: Most relevant memories surface first
3. **Background Processing**: Async operations don't lose data
4. **Protocol Compliance**: MCP communication works correctly
5. **Performance**: Operations complete within acceptable timeframes
6. **Error Handling**: System degrades gracefully under failure

**Test Statistics:**
- **Total Tests**: 149 (main suite)
- **Test Files**: 13 active test suites
- **Execution Time**: ~20 seconds (full suite)
- **Coverage Target**: 70%

---

## Test Organization

```
tests/
├── unit/              # Fast, isolated component tests
│   ├── storage.test.ts
│   ├── retrieval.test.ts
│   ├── patterns.test.ts
│   ├── pattern-detector.test.ts
│   ├── memory-enhancer.test.ts
│   └── queue-system.test.ts
├── integration/       # Cross-component workflow tests
│   ├── claude-code-integration.test.ts
│   ├── queue-integration.test.ts
│   └── intelligent-retrieval.test.ts
├── mcp/              # MCP protocol compliance tests
│   ├── rate-limiter.test.ts
│   ├── session-manager.test.ts
│   └── stdio-transport.test.ts
├── experimental/     # Research/experimental tests (excluded)
│   └── ai-testing-system.test.ts
├── benchmarks/       # Performance tests (excluded)
│   └── queue-performance.test.ts
├── templates/        # Test templates for new tests
├── utils/           # Test utilities (MCPTestClient)
└── config/          # Jest configuration
```

---

## Unit Tests

Unit tests use in-memory SQLite (`:memory:`) for fast, isolated testing without persistence.

### storage.test.ts

**Location**: `tests/unit/storage.test.ts`

**Purpose**: Verifies the MemoryStorage layer correctly persists and retrieves memories from SQLite.

**What it tests:**
- **Save/Retrieve**: Basic CRUD operations work correctly
- **Access Tracking**: Updates `access_count` and `last_accessed` on retrieval
- **Context Search**: Filter memories by project, file path, or type
- **Query Search**: Full-text search by keyword
- **Statistics**: Count memories by type
- **Updates**: Overwrite existing memories
- **Multiple Initializations**: Schema creation is idempotent

**Why it matters:**
The storage layer is the foundation of persistent memory. If this fails, Claude loses all knowledge between sessions.

**Key assertions:**
```typescript
expect(retrieved?.value).toEqual(memory.value);
expect(second?.access_count).toBe(2);
expect(project1Memories).toHaveLength(2);
```

---

### retrieval.test.ts

**Location**: `tests/unit/retrieval.test.ts`

**Purpose**: Ensures the MemoryRetrieval engine surfaces the most relevant memories first.

**What it tests:**
- **Relevance Scoring**: Memories sorted by score (project + file + base score)
- **Forgetting Curve**: Older memories decay in relevance
- **Access Boost**: Frequently accessed memories rank higher
- **Recency Boost**: Recently accessed memories rank higher
- **Result Limiting**: Returns top 5 results only
- **Keyword Search**: Search by keyword with relevance scoring

**Why it matters:**
Claude has limited context. We must provide the MOST relevant memories, not just any memories.

**Scoring formula:**
```
final_score = base_score * time_decay * access_boost * recency_boost * context_match
```

**Key assertions:**
```typescript
expect(results[0].score).toBeGreaterThan(results[1].score);
expect(recentMemory.score).toBeGreaterThan(oldMemory.score);
expect(results.length).toBe(5); // Top 5 only
```

---

### patterns.test.ts

**Location**: `tests/unit/patterns.test.ts`

**Purpose**: Detects correction patterns in code changes to learn user preferences.

**What it tests:**
- **Correction Detection**: Identify when user corrects code (e.g., `var` → `const`)
- **Pattern Generalization**: Abstract specifics to patterns (`var IDENTIFIER` → `const IDENTIFIER`)
- **Context Classification**: Categorize corrections (variable-declaration, function-call, etc.)
- **Frequency Tracking**: Count how often each pattern appears
- **Pattern Storage**: Save patterns to database
- **Pattern Retrieval**: Get most frequent patterns

**Why it matters:**
Claude learns from corrections. If you always change `var` to `const`, Claude should start using `const` automatically.

**Example pattern:**
```json
{
  "original": "var IDENTIFIER = STRING",
  "corrected": "const IDENTIFIER = STRING",
  "context": "variable-declaration",
  "frequency": 5
}
```

**Key assertions:**
```typescript
expect(pattern?.original).toBe('var IDENTIFIER = STRING');
expect(pattern?.corrected).toBe('const IDENTIFIER = STRING');
expect(frequent[0].frequency).toBeGreaterThanOrEqual(3);
```

---

### pattern-detector.test.ts

**Location**: `tests/unit/pattern-detector.test.ts`

**Purpose**: Detects task types and entities from user prompts to provide context-aware memory retrieval.

**What it tests:**
- **Task Type Detection**: Classify prompts (create_test, fix_bug, refactor, add_feature, explain, review)
- **Entity Extraction**: Extract file paths and function names from prompts
- **Language Detection**: Identify programming language from file extensions
- **Framework Detection**: Identify frameworks (React, Vue, Express)

**Why it matters:**
When you say "create a test", Claude should retrieve your test directory preference. When you say "fix TypeError", Claude should retrieve previous TypeError fixes.

**Example detections:**
```typescript
'create a test for auth module' → task: 'create_test', entities: ['auth']
'fix TypeError in user.service.ts' → task: 'fix_bug', entities: ['user.service.ts'], lang: 'typescript'
'refactor to use React hooks' → task: 'refactor', framework: 'react'
```

**Key assertions:**
```typescript
expect(result.taskType).toBe('create_test');
expect(result.entities).toContain('auth.service.ts');
expect(result.language).toBe('typescript');
```

---

### memory-enhancer.test.ts

**Location**: `tests/unit/memory-enhancer.test.ts`

**Purpose**: Enhances memory search by combining direct matches with pattern-based suggestions.

**What it tests:**
- **Direct Search**: Returns exact keyword matches
- **Pattern-Enhanced Search**:
  - `create_test` task → search for "test directory" preference
  - `fix_bug` task → search for error type in prompt
  - `refactor` task → search for code style preferences
  - `add_feature` task → search for similar features
- **Deduplication**: Remove duplicate memories, keeping highest score
- **Empty Results**: Handle no matches gracefully

**Why it matters:**
Makes retrieval smarter. Instead of just searching for keywords, we understand what you're trying to do and suggest relevant context.

**Example flow:**
```
User: "create a test for the user service"
1. Direct search: "test user service" → finds user service memories
2. Pattern detection: task = create_test
3. Enhanced search: "test directory" → finds preference: "tests/"
4. Combined results: user service memories + test directory preference
```

**Key assertions:**
```typescript
expect(result).toContainEqual(expect.objectContaining({
  key: 'pref_test_dir',
  type: 'preference'
}));
expect(dupMemories).toHaveLength(1); // Deduplication works
```

---

### queue-system.test.ts

**Location**: `tests/unit/queue-system.test.ts`

**Purpose**: Verifies the queue system handles background processing reliably without data loss.

**What it tests:**
- **Race Condition Prevention**: Concurrent dequeues don't process same message twice
- **Payload Size Limits**: Reject payloads > 1MB
- **Exponential Backoff**: Retry delays grow exponentially with jitter
- **Dead Letter Queue**: Failed messages after max retries go to DLQ
- **Memory Leak Prevention**: Resources cleaned up on shutdown
- **Queue Configuration**: Custom retry settings per queue
- **Database Access**: Safe read-only query access
- **Transaction Support**: Multi-operation atomic transactions
- **Edge Cases**: Malformed JSON, queue overflow, missing queues
- **Cleanup**: Old completed messages automatically deleted

**Why it matters:**
Background processing (pattern detection, memory enhancement) must not lose data or crash. If queue system fails, memories might not be stored or analyzed.

**Key concepts:**
- **Message Lifecycle**: pending → processing → completed/failed → (retry or DLQ)
- **Concurrency Safety**: SQLite transactions prevent race conditions
- **Fault Tolerance**: Exponential backoff + DLQ ensure resilience

**Key assertions:**
```typescript
expect(processedMessages.size).toBe(processedArray.length); // No duplicates
expect(retryDelays[1]).toBeGreaterThan(retryDelays[0]); // Exponential backoff
expect(dlqMessages).toHaveLength(1); // DLQ captures failures
expect(() => queueSystem.enqueue()).toThrow(); // Cleanup works
```

---

## Integration Tests

Integration tests use real database files and test cross-component workflows.

### claude-code-integration.test.ts

**Location**: `tests/integration/claude-code-integration.test.ts`

**Purpose**: Verifies the MCP server works correctly when Claude Code connects to it.

**What it tests:**
- **Protocol Compliance**:
  - Returns correct MCP version (2024-11-05)
  - Lists all registered tools (≥5 tools)
  - Tool schemas are valid JSON Schema
- **Memory Operations**:
  - Store memories via `mcp__claude-recall__store_memory`
  - Search memories via `mcp__claude-recall__search`
  - Retrieve recent memories via `mcp__claude-recall__retrieve_memory`
  - Handle metadata correctly
- **Session Persistence**:
  - Memories survive server restarts
  - Stats reflect correct counts after restart
- **Error Handling**:
  - Invalid tool calls return proper errors
  - Missing required parameters return validation errors
  - Clear context requires confirmation
- **Health Monitoring**:
  - Health check returns status, version, uptime, database connection

**Why it matters:**
This is the end-to-end test. If this fails, Claude Code can't use the memory system.

**Test setup:**
- Spawns actual MCP server process (`node dist/cli/claude-recall-cli.js mcp start`)
- Uses MCPTestClient to simulate Claude Code
- Communicates via JSON-RPC over stdio

**Key assertions:**
```typescript
expect(response.result.protocolVersion).toBe('2024-11-05');
expect(tools.length).toBeGreaterThanOrEqual(5);
expect(storeResponse.result.content[0].text).toContain('"success": true');
expect(newCount).toBeGreaterThan(initialCount); // Persistence works
expect(response.error?.message).toContain('Tool not found');
```

---

### queue-integration.test.ts

**Location**: `tests/integration/queue-integration.test.ts`

**Purpose**: Verifies the queue system integrates correctly with hooks, MCP operations, and memory service.

**What it tests:**

**Integration Service:**
- Initialize without errors
- Register all queue processors (hook, MCP, memory, pattern)
- Provide system health metrics
- Provide queue statistics

**Hook Integration:**
- Process tool use events through queue
- Process user prompts through queue
- Process Claude responses through queue

**MCP Integration:**
- Process MCP tool calls through queue
- Process memory searches with high priority (6)
- Process memory store operations with medium-high priority (5)

**Memory Service Integration:**
- Patch MemoryService to route pattern detection to queue
- Background processing doesn't block synchronous operations

**Queue MCP Tools:**
- `mcp__claude-recall__queue_status` - System health
- `mcp__claude-recall__queue_stats` - Queue statistics
- `mcp__claude-recall__queue_peek` - View queued messages
- `mcp__claude-recall__queue_enqueue` - Manual enqueue

**Enhanced Memory MCP Tools:**
- `mcp__claude-recall__async_memory_search` - Async search
- `mcp__claude-recall__async_pattern_detection` - Async pattern analysis
- `mcp__claude-recall__bulk_memory_operation` - Batch operations

**Error Handling:**
- Processor errors don't crash system
- Failed messages move to dead letter queue
- Invalid tool names throw proper errors
- Missing parameters validated

**Why it matters:**
Background processing must work seamlessly. Pattern detection, memory enhancement, and analytics happen asynchronously without blocking Claude Code.

**Key assertions:**
```typescript
expect(health.isHealthy).toBe(true);
expect(toolUseMessage!.payload.toolName).toBe(toolName);
expect(searchMessage!.priority).toBe(6); // High priority
expect(result.message_id).toBeGreaterThan(0);
expect(Array.isArray(dlqMessages)).toBe(true);
```

---

### intelligent-retrieval.test.ts

**Location**: `tests/integration/intelligent-retrieval.test.ts`

**Purpose**: Validates that memory retrieval actually helps Claude in real-world scenarios.

**What it tests:**

**Real-World Scenarios:**
1. **Test Creation**: "create a test for auth" → retrieves test directory preference
2. **Bug Fixing**: "fix TypeError" → retrieves previous TypeError fixes
3. **Refactoring**: "refactor to use async" → retrieves async/await preferences
4. **API Development**: "add user endpoint" → retrieves API conventions

**Pattern Detection Integration:**
- Identify test creation tasks without explicit "directory" mention
- Identify bug fix patterns and retrieve relevant fixes
- Handle prompts without explicit keywords

**Performance Requirements:**
- All searches complete within 100ms
- Handle large result sets efficiently (limits to 10 results)

**Backwards Compatibility:**
- Work when pattern detection returns empty
- Preserve existing direct search functionality

**Why it matters:**
This validates the entire system works together to provide useful context to Claude. If these scenarios fail, the memory system isn't actually helpful.

**Test data setup:**
```typescript
// Test directory preference
'Tests should be saved in tests/ directory'

// Error history
'TypeError: Cannot read property of undefined' → 'Added null check'

// Code style preferences
'prefer arrow functions for callbacks'
'use async/await instead of promises'

// API conventions
'/api/v1' base URL, plural nouns, RESTful methods
```

**Key assertions:**
```typescript
expect(testDirMemory).toBeDefined();
expect(testDirMemory?.type).toBe('preference');
expect(errorFixMemory?.value).toHaveProperty('fix');
expect(endTime - startTime).toBeLessThan(100); // Performance
```

---

## MCP Protocol Tests

Tests for MCP protocol compliance and infrastructure.

### rate-limiter.test.ts

**Location**: `tests/mcp/rate-limiter.test.ts`

**Purpose**: Ensures rate limiting prevents abuse and ensures fair usage.

**What it tests:**
- **Request Limiting**: Allow N requests per time window, deny after
- **Window Reset**: Limits reset after time window expires
- **Request Tracking**: Track successful vs failed requests separately
- **Skip Successful**: Option to only count failed requests
- **Remaining Requests**: Get count of remaining requests
- **Reset Limit**: Manually clear rate limit for session
- **Statistics**: Get rate limiter stats (active sessions, total requests, top sessions)
- **Automatic Cleanup**: Old entries cleaned up after window expires

**Configuration:**
```typescript
{
  windowMs: 60000,        // 1 minute window
  maxRequests: 100,       // 100 requests per minute
  skipSuccessfulRequests: false
}
```

**Why it matters:**
Prevents a single misbehaving client from overloading the system. Ensures fair resource allocation across sessions.

**Key assertions:**
```typescript
expect(allowed).toBe(false); // 6th request denied
expect(allowed).toBe(true);  // After window reset
expect(stats.activeSessions).toBe(3);
expect(rateLimiter.getRemainingRequests(sessionId)).toBe(4);
```

---

### session-manager.test.ts

**Location**: `tests/mcp/session-manager.test.ts`

**Purpose**: Manages Claude Code conversation sessions across restarts.

**What it tests:**
- **Session Creation**: Create new session with correct properties
- **Session Persistence**: Save sessions to disk (~/.claude-recall/sessions.json)
- **Session Retrieval**: Get existing session by ID
- **Session Updates**: Update metadata, track lastActivity
- **Tool Call Tracking**: Increment tool call count
- **Memory Tracking**: Track memory IDs created in session
- **Old Session Cleanup**: Remove sessions older than 24 hours
- **Active Session Count**: Count sessions active in last 5 minutes
- **Disk Persistence**: Load sessions from disk on startup

**Session structure:**
```typescript
{
  id: 'session-123',
  startTime: 1234567890,
  lastActivity: 1234567890,
  toolCalls: 0,
  memories: [],
  metadata: {}
}
```

**Why it matters:**
Sessions maintain state across Claude Code conversations. Without this, each restart is a blank slate.

**Key assertions:**
```typescript
expect(session.id).toBe(sessionId);
expect(session.toolCalls).toBe(2);
expect(session.memories).toEqual(['memory-1', 'memory-2']);
expect(sessionManager.getActiveSessionCount()).toBe(1);
expect(loadedSession?.id).toBe(sessionId); // Persistence works
```

---

### stdio-transport.test.ts

**Location**: `tests/mcp/stdio-transport.test.ts`

**Purpose**: Verifies JSON-RPC communication over stdin/stdout works correctly.

**What it tests:**
- JSON-RPC request/response format
- Error handling
- Protocol compliance

**Why it matters:**
This is how Claude Code communicates with the MCP server. If this fails, no communication is possible.

---

## Experimental Tests

**Location**: `tests/experimental/`

**Status**: Excluded from main test suite (marked with `describe.skip`)

### ai-testing-system.test.ts

**Purpose**: Research into AI-powered testing and self-improvement.

**What it tests:**
- Autonomous test generation
- Self-healing tests
- Pattern learning from test failures

**Why excluded:**
Experimental and unstable. May fail unpredictably. Kept for research purposes.

**To run:**
```bash
npm run test:experimental
```

---

## Benchmarks

**Location**: `tests/benchmarks/`

**Status**: Excluded from main test suite

### queue-performance.test.ts

**Purpose**: Performance testing for queue system under heavy load.

**What it tests:**
- Enqueue 10,000+ messages
- Concurrent dequeue operations
- Throughput measurements
- Memory usage under load

**Why excluded:**
Takes significant time (~30-60 seconds). Not needed for daily TDD.

**To run:**
```bash
npm run test:benchmarks
```

---

## Quick Reference

### Test Execution

```bash
# Daily TDD workflow
npm run test:unit              # Fast unit tests (~5s)
npm run test:watch:unit        # Watch mode for TDD

# Full test suite
npm test                       # All main tests (~20s)

# Specific categories
npm run test:integration       # Integration tests
npm run test:mcp              # MCP protocol tests

# Coverage
npm run test:coverage:unit     # Fast coverage (~1 min)
npm test -- --coverage         # Full coverage (~2-5 min)

# Optional
npm run test:benchmarks        # Performance benchmarks
npm run test:experimental      # Experimental tests
```

### Test Summary Table

| Test File | Category | Tests | Purpose | Speed |
|-----------|----------|-------|---------|-------|
| storage.test.ts | Unit | 8 | Database persistence | Fast |
| retrieval.test.ts | Unit | 6 | Memory relevance scoring | Fast |
| patterns.test.ts | Unit | 4 | Correction pattern detection | Fast |
| pattern-detector.test.ts | Unit | 4 | Task pattern detection | Fast |
| memory-enhancer.test.ts | Unit | 4 | Enhanced search | Fast |
| queue-system.test.ts | Unit | 14 | Background processing | Medium |
| claude-code-integration.test.ts | Integration | 12 | MCP server end-to-end | Slow |
| queue-integration.test.ts | Integration | 15 | Queue system integration | Medium |
| intelligent-retrieval.test.ts | Integration | 10 | Real-world scenarios | Medium |
| rate-limiter.test.ts | MCP | 7 | Rate limiting | Fast |
| session-manager.test.ts | MCP | 8 | Session management | Fast |
| stdio-transport.test.ts | MCP | 5 | JSON-RPC communication | Fast |

**Total: 97 tests in main suite** (excluding experimental and benchmarks)

### Coverage by Component

| Component | Coverage Target | Critical Paths |
|-----------|----------------|----------------|
| Storage Layer | 90% | Save, retrieve, search |
| Retrieval Engine | 85% | Scoring, ranking, filtering |
| Pattern Detection | 80% | Detection algorithms |
| Queue System | 85% | Enqueue, dequeue, retry, DLQ |
| MCP Server | 75% | Protocol compliance, tool handling |
| Services | 70% | Business logic coordination |

### Common Test Patterns

**Unit Test Structure:**
```typescript
describe('Component', () => {
  let component: Component;

  beforeEach(() => {
    // Setup with in-memory database
    component = new Component(':memory:');
  });

  afterEach(() => {
    // Cleanup
    component.close();
  });

  it('should [behavior]', () => {
    // Arrange
    const input = createTestData();

    // Act
    const result = component.method(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

**Integration Test Structure:**
```typescript
describe('Integration', () => {
  beforeAll(async () => {
    // Start MCP server
    // Connect client
  });

  afterAll(async () => {
    // Cleanup
  });

  it('should [end-to-end behavior]', async () => {
    // Arrange
    const request = createRequest();

    // Act
    const response = await client.request(request);

    // Assert
    expect(response.result).toBeDefined();
  });
});
```

---

## Test Philosophy

### What We Test

1. **Public APIs**: Focus on behavior, not implementation
2. **Error Cases**: Verify graceful degradation
3. **Edge Cases**: Empty inputs, large datasets, concurrent access
4. **Integration Points**: Cross-component workflows
5. **Performance**: Critical paths meet timing requirements

### What We Don't Test

1. **Private Methods**: Test through public APIs
2. **Third-Party Code**: Trust better-sqlite3, Node.js
3. **Type Checking**: TypeScript handles this
4. **Trivial Code**: Getters, setters, simple constructors

### Test Quality Guidelines

**Good Test Characteristics:**
- **Fast**: Unit tests run in milliseconds
- **Isolated**: No shared state between tests
- **Deterministic**: Same input = same output
- **Readable**: Clear arrange-act-assert structure
- **Focused**: One concept per test
- **Maintainable**: Changes to code don't break unrelated tests

**Bad Test Characteristics:**
- Flaky (passes/fails randomly)
- Slow (blocks TDD workflow)
- Fragile (breaks on minor refactoring)
- Unclear (hard to understand what's being tested)
- Coupled (depends on other tests running first)

---

## Troubleshooting

### Common Test Failures

**"Database is locked"**
- Cause: Multiple tests accessing same database file
- Fix: Use unique database files per test with timestamp + random ID

**"Expected X, received Y+1"**
- Cause: Test isolation issues, previous test state leaking
- Fix: Reset singletons in `beforeEach`, use unique database files

**"Timeout exceeded"**
- Cause: Async operation not completing
- Fix: Increase timeout or check if operation is actually completing

**"Memory schema mismatch"**
- Cause: Memory storage schema evolved
- Fix: Handle both old and new schema formats in assertions

### Test Debugging

```bash
# Run specific test file
npx jest tests/unit/storage.test.ts

# Run specific test
npx jest -t "should save and retrieve memories"

# Run with verbose output
npx jest --verbose

# Run with coverage
npx jest --coverage tests/unit/storage.test.ts
```

---

## Contributing

When adding new tests:

1. **Choose the right category**: Unit vs Integration vs MCP
2. **Use templates**: Copy from `tests/templates/`
3. **Follow naming**: `[component].test.ts`
4. **Isolate tests**: Use `:memory:` for unit tests
5. **Document intent**: Comment WHY, not WHAT
6. **Keep fast**: Unit tests should be < 100ms

---

## Related Documentation

- [TDD Guide](TDD-GUIDE.md) - How to write and run tests
- [CLAUDE.md](../CLAUDE.md) - Project architecture overview
- [README.md](../README.md) - Project overview and setup

---

**Last Updated**: 2025-10-14
