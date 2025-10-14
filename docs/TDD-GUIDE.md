# Test-Driven Development (TDD) Guide for Claude Recall

This guide explains how to use Test-Driven Development when working on Claude Recall, an MCP server that runs inside Claude Code.

## The Challenge

Claude Recall is an MCP (Model Context Protocol) server that integrates with Claude Code. Normally, testing such a system would require:
- Starting Claude Code
- Manually testing each feature
- Restarting after each change

This makes TDD impractical. **But Claude Recall solves this!**

## The Solution: Three Testing Strategies

### 1. Unit Tests - Fast, Isolated Testing

**Purpose:** Test individual components in complete isolation.

**Key Feature:** Uses SQLite's `:memory:` mode for zero-persistence testing.

**Example:**
```typescript
// tests/unit/my-feature.test.ts
import { MemoryStorage } from '../../src/memory/storage';
import { MemoryRetrieval } from '../../src/core/retrieval';

describe('MyFeature', () => {
  let storage: MemoryStorage;
  let retrieval: MemoryRetrieval;

  beforeEach(() => {
    // Fresh in-memory database for each test
    storage = new MemoryStorage(':memory:');
    retrieval = new MemoryRetrieval(storage);
  });

  afterEach(() => {
    storage.close();
  });

  it('should retrieve relevant memories', () => {
    // Arrange
    storage.save({
      key: 'test-key',
      value: { preference: 'TypeScript' },
      type: 'preference',
      project_id: 'my-project'
    });

    // Act
    const results = retrieval.findRelevant({
      project_id: 'my-project'
    });

    // Assert
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].value.preference).toBe('TypeScript');
  });
});
```

**Run unit tests:**
```bash
npm run test:unit
```

---

### 2. Integration Tests - Test MCP Protocol

**Purpose:** Test the MCP server exactly as Claude Code would use it, without needing Claude Code.

**Key Feature:** Uses `MCPTestClient` to simulate Claude Code's communication.

**How it works:**
1. Spawns the MCP server as a child process
2. Communicates via stdio (JSON-RPC) like Claude Code does
3. Sends real MCP protocol requests
4. Validates responses

**Example:**
```typescript
// tests/integration/my-mcp-feature.test.ts
import { spawn } from 'child_process';
import { MCPTestClient } from '../utils/mcp-test-client';

describe('My MCP Feature', () => {
  let mcpProcess: any;
  let client: MCPTestClient;

  beforeAll(async () => {
    // Start the MCP server
    mcpProcess = spawn('node', ['dist/cli/claude-recall-cli.js', 'mcp', 'start']);

    // Create test client
    client = new MCPTestClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    mcpProcess.kill('SIGTERM');
  });

  it('should store and retrieve memories via MCP', async () => {
    // Store a memory using MCP tool
    const storeResponse = await client.request('tools/call', {
      name: 'mcp__claude-recall__store_memory',
      arguments: {
        content: 'User prefers Jest for testing',
        metadata: { type: 'preference' }
      }
    });

    expect(storeResponse.result.content[0].text).toContain('"success": true');

    // Retrieve it using MCP search
    const searchResponse = await client.request('tools/call', {
      name: 'mcp__claude-recall__search',
      arguments: {
        query: 'Jest testing'
      }
    });

    const results = JSON.parse(searchResponse.result.content[0].text);
    expect(results.results.length).toBeGreaterThan(0);
    expect(results.results[0].content.content).toContain('Jest');
  });
});
```

**Run integration tests:**
```bash
npm run test:integration
```

---

### 3. Performance Tests - Benchmark Queue Operations

**Purpose:** Test performance characteristics of the queue system.

**Location:** `tests/performance/`

**Run performance tests:**
```bash
npx jest tests/performance/
```

---

## TDD Workflow

### Classic Red-Green-Refactor Cycle

#### Step 1: Write a Failing Test (RED)

```typescript
// tests/unit/priority-scoring.test.ts
describe('Priority Scoring', () => {
  it('should prioritize recently modified files', () => {
    const storage = new MemoryStorage(':memory:');
    const retrieval = new MemoryRetrieval(storage);

    storage.save({
      key: 'recent',
      value: { data: 'recent file' },
      type: 'project-knowledge',
      timestamp: Date.now()
    });

    storage.save({
      key: 'old',
      value: { data: 'old file' },
      type: 'project-knowledge',
      timestamp: Date.now() - (30 * 24 * 60 * 60 * 1000) // 30 days ago
    });

    const results = retrieval.findRelevant({});

    expect(results[0].key).toBe('recent'); // FAILS - feature not implemented yet
  });
});
```

**Run the test:**
```bash
npx jest tests/unit/priority-scoring.test.ts
# ❌ Test fails - expected behavior not implemented
```

#### Step 2: Implement the Feature (GREEN)

```typescript
// src/core/retrieval.ts
private calculateRelevance(memory: Memory, context: Context): number {
  let score = memory.relevance_score || 1.0;

  // NEW: Time-based decay
  const daysSince = (Date.now() - (memory.timestamp || Date.now())) / (1000 * 60 * 60 * 24);
  score *= Math.pow(0.9, daysSince / 30);

  return score;
}
```

**Run the test again:**
```bash
npx jest tests/unit/priority-scoring.test.ts
# ✅ Test passes - feature works!
```

#### Step 3: Refactor (REFACTOR)

Clean up the implementation, run tests again to ensure nothing broke:

```bash
npm test
# ✅ All tests still pass
```

---

## Quick Reference: Test Commands

```bash
# Run all tests (main suite only, excludes experimental/benchmarks)
npm test

# Run only unit tests (FAST - recommended for TDD)
npm run test:unit

# Run only integration tests
npm run test:integration

# Run only MCP protocol tests
npm run test:mcp

# Watch mode for unit tests (re-runs on file change)
npm run test:watch:unit

# Run specific test file
npx jest tests/unit/storage.test.ts

# Run tests matching a pattern
npx jest --testNamePattern="should store memories"

# Coverage commands (see Coverage section below)
npm run test:coverage:unit          # Fast - unit tests only (~1 min)
npm run test:coverage:integration   # Integration tests only
npm test -- --coverage              # Full coverage (slower, ~2-5 min)

# Optional: Run experimental/research tests
npm run test:experimental

# Optional: Run performance benchmarks
npm run test:benchmarks
```

---

## Using MCPTestClient

The `MCPTestClient` (in `tests/utils/mcp-test-client.ts`) provides a programmatic interface to test MCP functionality:

### Basic Usage

```typescript
import { MCPTestClient } from '../utils/mcp-test-client';

const client = new MCPTestClient();
await client.connect();

// Send JSON-RPC request
const response = await client.request('tools/list', {});

await client.disconnect();
```

### Helper Methods

```typescript
// Initialize the MCP protocol
await client.initialize({});

// List available tools
const tools = await client.listTools();

// Call a specific tool
const result = await client.callTool('mcp__claude-recall__store_memory', {
  content: 'Test memory'
});

// Check server health
const health = await client.checkHealth();
```

---

## Best Practices

### 1. Always Use In-Memory Database for Unit Tests

```typescript
// ✅ Good
storage = new MemoryStorage(':memory:');

// ❌ Bad - creates actual file
storage = new MemoryStorage('./test.db');
```

### 2. Clean Up After Tests

```typescript
afterEach(() => {
  storage.close();
});

afterAll(async () => {
  await client.disconnect();
  mcpProcess.kill('SIGTERM');
});
```

### 3. Use Descriptive Test Names

```typescript
// ✅ Good
it('should prioritize memories from the same project', () => {});

// ❌ Bad
it('works', () => {});
```

### 4. Test One Thing Per Test

```typescript
// ✅ Good - focused test
it('should increment access count on retrieval', () => {
  storage.save({ key: 'test', value: {}, type: 'test' });
  storage.retrieve('test');
  const memory = storage.retrieve('test');
  expect(memory.access_count).toBe(2);
});

// ❌ Bad - testing multiple behaviors
it('should do everything', () => {
  // Tests storage, retrieval, search, and updates all in one test
});
```

### 5. Use Arrange-Act-Assert Pattern

```typescript
it('should calculate relevance score', () => {
  // Arrange - set up test data
  const memory = { ... };
  const context = { ... };

  // Act - execute the behavior
  const score = calculateRelevance(memory, context);

  // Assert - verify the result
  expect(score).toBeGreaterThan(0);
});
```

---

## Test Coverage

The project maintains **70% code coverage** threshold (configured in `jest.config.js`).

### Coverage Commands

**Fast coverage (unit tests only):**
```bash
npm run test:coverage:unit
# ⚡ Takes ~1 minute, perfect for daily TDD workflow
```

**Integration coverage:**
```bash
npm run test:coverage:integration
# Tests MCP protocol, takes ~2-3 minutes
```

**Full coverage (all tests):**
```bash
npm test -- --coverage
# 📊 Complete coverage report, takes ~2-5 minutes
# Use this before commits/PRs
```

### Why Is Full Coverage Slow?

1. **Code instrumentation**: Jest instruments every line for tracking
2. **Integration tests**: Spawns actual MCP server processes
3. **Database operations**: Multiple SQLite databases created

**Recommendation:** Use `npm run test:coverage:unit` for daily TDD, save full coverage for commits.

### Coverage Optimizations

The project is configured for optimal performance:
- Uses 50% of CPU cores (`maxWorkers: '50%'`)
- Excludes test utilities from coverage
- Caches test results
- Parallel test execution

**Coverage includes:**
- Line coverage
- Branch coverage
- Function coverage
- Statement coverage

---

## Testing Checklist

When adding a new feature:

- [ ] Write unit tests for core logic
- [ ] Write integration tests if it involves MCP protocol
- [ ] Ensure tests use in-memory database
- [ ] Add proper cleanup in `afterEach`/`afterAll`
- [ ] Run full test suite before committing
- [ ] Check coverage hasn't dropped below 70%

---

## Troubleshooting

### "Cannot find module" errors

**Solution:** Build the project first
```bash
npm run build
npm test
```

### Integration tests hang

**Solution:** Ensure MCP server process is killed
```typescript
afterAll(async () => {
  if (mcpProcess) {
    mcpProcess.kill('SIGKILL'); // Force kill if SIGTERM doesn't work
  }
});
```

### Tests fail randomly

**Solution:** Use unique keys/timestamps to avoid conflicts
```typescript
const uniqueKey = `test_${Date.now()}_${Math.random()}`;
```

---

## Test Organization

Tests are organized by purpose:

```
tests/
├── unit/              # Fast, isolated component tests
├── integration/       # Cross-component workflow tests
├── mcp/              # MCP protocol tests
├── experimental/     # Research/experimental tests (optional)
├── benchmarks/       # Performance tests (optional)
├── templates/        # Test templates for new tests
└── utils/           # Test utilities (MCPTestClient)
```

**Main Test Suite** (runs with `npm test`):
- Unit tests - Core business logic
- Integration tests - System workflows
- MCP tests - Protocol compliance

**Optional Tests** (run separately):
- Experimental - Advanced/unstable features (`npm run test:experimental`)
- Benchmarks - Performance testing (`npm run test:benchmarks`)

## Examples from the Codebase

**Unit Test Examples:**
- `tests/unit/storage.test.ts` - Memory storage operations
- `tests/unit/retrieval.test.ts` - Relevance scoring and search
- `tests/unit/queue-system.test.ts` - Queue operations

**Integration Test Examples:**
- `tests/integration/claude-code-integration.test.ts` - Full MCP protocol testing
- `tests/integration/queue-integration.test.ts` - Queue system integration

**MCP Component Tests:**
- `tests/mcp/rate-limiter.test.ts` - Rate limiting
- `tests/mcp/session-manager.test.ts` - Session management
- `tests/mcp/stdio-transport.test.ts` - Transport layer

---

## Summary

✅ **You CAN do TDD** without running Claude Code
✅ **Unit tests** are fast (milliseconds)
✅ **Integration tests** simulate real MCP communication
✅ **Full test coverage** ensures quality
✅ **CI/CD ready** - tests can run automatically

**Start with unit tests, add integration tests for MCP features, and follow the Red-Green-Refactor cycle!**
