# Restart Continuity & Live Testing System

## Overview

The Restart Continuity System enables Claude Recall to maintain state across Claude Code restarts, allowing for continuous testing workflows that survive process restarts. This is crucial because changes to hooks or CLI require Claude Code to be restarted for the changes to take effect.

## Key Components

### 1. Restart Continuity Manager (`src/services/restart-continuity.ts`)

Manages state persistence and recovery across restarts.

**Features:**
- Detects when Claude Code has been restarted
- Persists test state and progress to disk
- Automatically resumes interrupted tests
- Tracks restart count and history
- Maintains checkpoints for test recovery

**State Management:**
- Session ID tracking
- Test progress monitoring
- Pending actions queue
- Checkpoint system for recovery

### 2. Live Testing Manager (`src/testing/live-testing-manager.ts`)

Orchestrates live testing sessions with automatic restart capability.

**Features:**
- Runs test scenarios with auto-restart on failure
- Watches files for changes that require restart
- Injects test results as searchable memories
- Configurable restart policies
- Session management and tracking

**Configuration Options:**
```typescript
{
  autoRestart: boolean,          // Enable automatic restart
  restartOnFailure: boolean,     // Restart when tests fail
  maxRestartAttempts: number,    // Limit restart attempts
  restartDelay: number,          // Delay between restarts (ms)
  watchFiles: string[],          // Files to watch for changes
  injectResults: boolean         // Store results as memories
}
```

## CLI Commands

### Start Live Testing
```bash
claude-recall live-test start [options]

Options:
  -s, --scenario <scenarios...>  Test scenarios to run
  -a, --auto-restart             Enable automatic restart
  -r, --restart-on-failure       Restart on test failures
  -m, --max-restarts <number>    Maximum restart attempts
  -i, --inject-results          Inject test results as memories

Example:
  claude-recall live-test start -s memory_persistence search_compliance
```

### Check Status
```bash
claude-recall live-test status
```
Shows current test session status, progress, and continuity state.

### View Continuity Information
```bash
claude-recall live-test continuity
```
Displays detailed continuity state including:
- Current session ID
- Restart count
- Test progress and checkpoints
- Pending actions

### Add Checkpoint
```bash
claude-recall live-test checkpoint <name>
```
Manually adds a checkpoint for recovery purposes.

### Simulate Restart
```bash
claude-recall live-test restart --reason <reason>
```
Simulates a restart for testing purposes.

## MCP Tools

New MCP tools are available for AI developers:

### `live_test_start`
Start a live testing session with automatic restart capability.
```json
{
  "tests": [
    { "name": "memory_persistence", "params": {} }
  ],
  "config": {
    "autoRestart": true,
    "restartOnFailure": true,
    "maxRestartAttempts": 3
  }
}
```

### `live_test_status`
Get the current status of the live testing session.

### `continuity_status`
Get the current continuity state and restart information.

### `continuity_checkpoint`
Add a checkpoint to the current test for restart recovery.
```json
{
  "checkpoint": "pre_validation_phase"
}
```

### `trigger_restart`
Manually trigger a restart for testing purposes.
```json
{
  "reason": "manual_test"
}
```

## How It Works

### Restart Detection

1. **Lock File System**: Creates a PID lock file on startup
2. **Process Check**: Verifies if previous process is still running
3. **State Recovery**: Loads previous state if restart detected
4. **Session Continuity**: Creates new session ID while preserving state

### State Persistence

State is persisted to `~/.claude-recall/continuity/state.json`:
```json
{
  "sessionId": "session_1234567890_abc",
  "testInProgress": true,
  "currentTest": {
    "name": "memory_persistence",
    "startTime": 1234567890,
    "checkpoints": ["start", "memory_stored", "validation"]
  },
  "pendingActions": [],
  "lastActivity": 1234567890,
  "restartCount": 2
}
```

### Test Recovery

When a test is interrupted by restart:
1. State is loaded from disk
2. Test progress is analyzed via checkpoints
3. Test resumes from last checkpoint
4. Results are injected as memories

### Memory Injection

Test results and insights are automatically stored as searchable memories:
- `test/result/injected/{testName}` - Full test results
- `test/insight/fix/{testName}` - Suggested fixes
- `test/failure/{sessionId}/{testName}` - Failure information
- `restart/event/{sessionId}` - Restart events
- `continuity/current_state` - Current continuity state

## Use Cases

### 1. Testing Hook Changes
```bash
# Start live testing with file watching
claude-recall live-test start -s search_compliance

# Modify a hook file
# System automatically detects change and restarts
# Test resumes from checkpoint after restart
```

### 2. Continuous Compliance Testing
```bash
# Run compliance tests with auto-restart on failure
claude-recall live-test start \
  -s memory_persistence search_compliance file_location_compliance \
  --restart-on-failure \
  --max-restarts 5
```

### 3. Development Workflow
```bash
# Start live testing in development
claude-recall live-test start --auto-restart

# Make changes to code
# System restarts and continues testing
# Results are injected as memories for AI analysis
```

## Integration with AI Testing

The restart continuity system integrates with the existing AI testing architecture:

- **Test Orchestrator**: Coordinates test execution across restarts
- **Observable Database**: Tracks database changes through restarts
- **Mock Claude**: Simulates agent behavior with continuity
- **Auto-Correction Engine**: Analyzes failures and suggests fixes

## Best Practices

1. **Use Checkpoints**: Add checkpoints at critical test phases for better recovery
2. **Configure Limits**: Set reasonable max restart attempts to prevent infinite loops
3. **Monitor Status**: Regularly check status to ensure tests are progressing
4. **Review Memories**: Check injected test results for insights and patterns
5. **Handle Failures**: Implement proper error handling in test scenarios

## Troubleshooting

### Tests Not Resuming After Restart
- Check if state file exists: `~/.claude-recall/continuity/state.json`
- Verify lock file is being created/removed properly
- Check logs for restart detection messages

### Infinite Restart Loop
- Reduce `maxRestartAttempts` in configuration
- Check for persistent failures in test logs
- Disable `restartOnFailure` temporarily

### State Not Persisting
- Verify write permissions for `~/.claude-recall/continuity/`
- Check disk space availability
- Review error logs for I/O issues

## Future Enhancements

- Distributed testing across multiple Claude Code instances
- Cloud state persistence for team collaboration
- Advanced checkpoint strategies with rollback
- Integration with CI/CD pipelines
- Real-time test result streaming