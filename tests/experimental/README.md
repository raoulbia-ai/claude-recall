# Experimental Tests

This directory contains experimental and research tests that are not part of the main test suite.

## What Are Experimental Tests?

Experimental tests are for:
- **Proof-of-concept features** not yet production-ready
- **Research and exploration** of new testing approaches
- **Advanced features** still under development
- **Self-testing systems** that may be unstable

These tests are **excluded from the main test suite** by default to:
- Keep test output clean
- Prevent false failures from blocking development
- Maintain fast test execution times
- Separate stable from experimental code

## Running Experimental Tests

To run experimental tests:

```bash
# Run all experimental tests
npx jest tests/experimental/

# Run specific experimental test file
npx jest tests/experimental/ai-testing-system.test.ts

# Run with watch mode
npx jest --watch tests/experimental/
```

## Current Experimental Tests

### AI Testing System (`ai-testing-system.test.ts`)

An advanced AI-powered testing framework that includes:
- **Test Orchestrator**: Runs memory persistence and compliance scenarios
- **Observable Database**: Tracks database changes during operations
- **Mock Claude Agent**: Simulates Claude interactions with configurable compliance
- **Scenario Runner**: Executes predefined test scenarios
- **Auto-Correction Engine**: Analyzes test failures and suggests fixes

**Status:** Experimental - not yet stable
**Tests:** 17 tests (all skipped in main suite)
**Purpose:** Research into self-correcting AI testing systems

## Adding New Experimental Tests

When adding experimental tests:

1. Place them in this directory
2. Use `describe.skip()` if they're unstable
3. Document what you're experimenting with
4. Update this README with a brief description
5. Move to main test suite when stable and proven

## Graduation to Main Suite

Tests can graduate from experimental to the main suite when:
- ✅ Feature is production-ready
- ✅ Tests are stable (passing consistently)
- ✅ Tests provide value for TDD workflow
- ✅ Tests run reasonably fast (< 30s)

Move graduated tests to appropriate directory:
- `tests/unit/` - Fast, isolated tests
- `tests/integration/` - System integration tests
- `tests/mcp/` - MCP protocol tests
