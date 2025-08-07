# Test Audit Report

## Summary
- **Total Test Suites**: 18
- **Passing**: 9
- **Failing**: 9
- **Total Tests**: 181
- **Passing Tests**: 122
- **Failing Tests**: 59

## Issue with NPM Scripts
**CRITICAL**: The character "2" is being appended to all npm script commands. This needs investigation but doesn't affect `npx` commands directly.

## Test Categories

### ✅ PASSING (100% Success)

#### Unit Tests - Core Memory Functions
- `tests/unit/storage.test.ts` - 7/7 tests passing
- `tests/unit/retrieval.test.ts` - 6/6 tests passing
- `tests/unit/patterns.test.ts` - 7/7 tests passing
- `tests/unit/pattern-detector.test.ts` - 9/9 tests passing
- `tests/unit/memory-enhancer.test.ts` - 4/4 tests passing

#### MCP Tests
- `tests/mcp/stdio-transport.test.ts` - All passing
- `tests/mcp/session-manager.test.ts` - 12/12 tests passing
- `tests/mcp/rate-limiter.test.ts` - 8/8 tests passing

#### Integration Tests
- `tests/integration/intelligent-retrieval.test.ts` - All passing

### ❌ FAILING TESTS (Grouped by Root Cause)

#### 1. Database Connection Issues (Critical)
**Root Cause**: "The database connection is not open" - QueueSystem closing DB prematurely

**Affected Tests**:
- `tests/unit/queue-system.test.ts` - 7 failures
- `tests/unit/queue-system-comprehensive.test.ts` - 11 failures
- `tests/unit/queue-edge-cases.test.ts` - 1 failure
- `tests/unit/queue-system-fixes.test.ts` - 5 failures
- `tests/integration/queue-integration.test.ts` - 18 failures
- `tests/performance/queue-performance.test.ts` - 8 failures

**Common Error**:
```
TypeError: The database connection is not open
at Database.prepare (node_modules/better-sqlite3/lib/methods/wrappers.js:5:21)
at QueueSystem.getPreparedStatement (src/services/queue-system.ts:140:48)
```

#### 2. TypeScript Compilation Errors
**File**: `tests/unit/queue-system-fixed.test.ts`
- Cannot run due to TS errors: `Property 'queueName' does not exist on type 'number'`
- Lines 346-347 have type issues

**File**: `tests/integration/ai-testing-system.test.ts`
- Cannot run due to TS error: `Property 'close' does not exist on type 'DatabaseManager'`
- Line 42 has type issue

#### 3. Test Logic/Assertion Failures

**Queue System Tests**:
- Race condition handling failures
- Retry logic not working as expected
- Dead letter queue not capturing failed messages correctly
- Message count mismatches (expecting different values)

**Integration Tests**:
- `tests/integration/claude-code-integration.test.ts`:
  - Lists 17 tools instead of expected 5
  - Session persistence not maintaining across restarts
  - Health status showing wrong tool count

#### 4. Missing Commands
**File**: `tests/memory-search-compliance.test.js`
- CLI command `store` doesn't exist (should be `capture` or different command)
- Test needs updating to use correct CLI commands

#### 5. File System Issues
**Error in multiple tests**:
```
Error: ENOENT: no such file or directory, open '/tmp/test-home/.claude-recall/continuity/state.json'
```
- RestartContinuityManager trying to save state to non-existent directory

## Tests to Consider Removing (Low Value)

### Duplicate Queue Tests
Multiple queue test files testing similar functionality:
- `queue-system.test.ts`
- `queue-system-comprehensive.test.ts`
- `queue-system-fixed.test.ts`
- `queue-system-fixes.test.ts`
- `queue-edge-cases.test.ts`

**Recommendation**: Consolidate into one comprehensive queue test suite

### Performance Tests
- `tests/performance/queue-performance.test.ts` - Mostly failing due to DB connection issues, not actual performance problems

## Immediate Actions Needed

1. **Fix Database Connection Management**
   - QueueSystem is closing database connections while tests are still running
   - Need proper cleanup in afterEach/afterAll hooks

2. **Fix TypeScript Errors**
   - Fix type issues in queue-system-fixed.test.ts
   - Fix DatabaseManager type issue in ai-testing-system.test.ts

3. **Update memory-search-compliance.test.js**
   - Change 'store' command to correct CLI command
   - Update test to match current CLI API

4. **Fix Directory Creation**
   - Ensure /tmp/test-home/.claude-recall/continuity/ exists before tests

5. **Investigate NPM Script Issue**
   - "2" being appended to all npm commands
   - Works fine with npx but breaks with npm run

## Working Test Commands

```bash
# Run specific test categories that work
npx jest tests/unit/storage.test.ts
npx jest tests/unit/retrieval.test.ts
npx jest tests/unit/patterns.test.ts
npx jest tests/unit/pattern-detector.test.ts
npx jest tests/unit/memory-enhancer.test.ts
npx jest tests/mcp --passWithNoTests
npx jest tests/integration/intelligent-retrieval.test.ts

# All tests (will show failures)
npx jest --passWithNoTests --forceExit
```