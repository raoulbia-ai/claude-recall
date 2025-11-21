# PubNub Integration Module

This directory contains the PubNub integration for autonomous memory management in Claude Recall.

## Files

### Core Components

- **`config.ts`** - PubNub channel architecture, message schemas, and types
- **`publisher.ts`** - Event publisher for sending events to PubNub
- **`publisher-cli.ts`** - CLI interface for publisher (used by Python hooks)
- **`memory-agent.ts`** - Autonomous memory agent (background daemon)
- **`agent-cli.ts`** - CLI for managing the memory agent

### Testing & Integration

- **`test-integration.ts`** - End-to-end integration test

## Architecture

```
Hooks → Publisher → PubNub → Agent → SQLite
         (fast)              (smart)  (local)
```

## Usage

### Publisher (from hooks)

```bash
# Publish tool event
node publisher-cli.js tool-pre '{"sessionId":"abc","toolName":"Write",...}'

# Publish prompt event
node publisher-cli.js prompt '{"sessionId":"abc","content":"I prefer TypeScript"}'
```

### Memory Agent (daemon)

```bash
# Start agent
node agent-cli.js start

# Check status
node agent-cli.js status

# View logs
node agent-cli.js logs

# Stop agent
node agent-cli.js stop
```

### Integration Test

```bash
# Build first
npm run build

# Run test
node dist/pubnub/test-integration.js
```

## Message Flow

### Tool Execution Flow

1. **Hook triggered** (Write tool called)
2. **Publisher sends** tool-pre event to `claude-tool-events`
3. **Agent receives** event, generates search query
4. **Agent searches** local SQLite for relevant memories
5. **Agent publishes** suggestions to `claude-memory-context`
6. **Claude Code receives** memory context (TODO: implement subscriber)

### Prompt Analysis Flow

1. **Hook triggered** (user submits prompt)
2. **Publisher sends** prompt to `claude-prompt-stream`
3. **Agent receives** prompt, analyzes for patterns
4. **Agent detects** preference/correction/project-knowledge
5. **Agent stores** memory in local SQLite
6. **Future searches** return stored preference

## Channels

| Channel | Publisher | Subscriber | Purpose |
|---------|-----------|------------|---------|
| `claude-tool-events` | Hooks | Agent | Tool execution events |
| `claude-prompt-stream` | Hooks | Agent | User prompts for analysis |
| `claude-memory-context` | Agent | Claude Code* | Memory suggestions |
| `claude-presence` | Agent | Monitoring* | Agent heartbeats |

*TODO: Implement Claude Code subscriber and monitoring dashboard

## Message Types

### Tool Event
```json
{
  "type": "tool.pre_execution",
  "timestamp": 1234567890,
  "sessionId": "session-abc",
  "projectId": "my-project",
  "toolName": "Write",
  "toolInput": {
    "file_path": "/src/auth.ts",
    "content": "..."
  }
}
```

### Prompt Event
```json
{
  "type": "prompt.submitted",
  "timestamp": 1234567890,
  "sessionId": "session-abc",
  "projectId": "my-project",
  "content": "I prefer TypeScript with strict mode",
  "role": "user"
}
```

### Memory Suggestion
```json
{
  "type": "memory.suggestion",
  "timestamp": 1234567890,
  "sessionId": "session-abc",
  "context": "Write on /src/auth.ts",
  "suggestions": [
    {
      "content": "I prefer TypeScript with strict mode",
      "type": "preference",
      "confidence": 0.9,
      "reason": "Relevant for TypeScript file creation"
    }
  ]
}
```

## Configuration

### Environment Variables

```bash
# PubNub credentials (optional, defaults to demo)
export PUBNUB_PUBLISH_KEY="pub-c-..."
export PUBNUB_SUBSCRIBE_KEY="sub-c-..."
export PUBNUB_USER_ID="claude-recall-$(whoami)"
```

### Default Configuration

See `getDefaultConfig()` in `config.ts`:
- Publish key: `demo` (or env var)
- Subscribe key: `demo` (or env var)
- SSL: `true`
- Heartbeat interval: `30s`
- Presence timeout: `60s`

## Development

### Build

```bash
npm run build
```

Compiles TypeScript to `dist/pubnub/`.

### Test

```bash
# Integration test
npm run test:pubnub

# Manual testing
node dist/pubnub/publisher-cli.js prompt '{"sessionId":"test","content":"test"}'
node dist/pubnub/agent-cli.js start
node dist/pubnub/agent-cli.js logs
```

### Debug

```bash
# Enable debug logs (TODO: implement)
DEBUG=pubnub:* node dist/pubnub/memory-agent.js

# Watch agent logs
tail -f ~/.claude-recall/agent/memory-agent.log
```

## Privacy & Security

- **PubNub is event coordination only** - no memory content stored
- **All memories remain local** in SQLite (~/.claude-recall/)
- **File contents never sent** - only metadata (paths, tool names)
- **Use unique keys** - don't share demo keys in production

## Performance

- **Hook overhead:** < 10ms (fire-and-forget)
- **Event latency:** < 30ms (PubNub global network)
- **Memory search:** < 50ms (local SQLite)
- **End-to-end:** ~200ms (event → context)

## Future Enhancements

- [ ] Claude Code subscriber for memory-context
- [ ] WebSocket support (lower latency)
- [ ] Batch event processing
- [ ] Memory relevance scoring algorithm
- [ ] Multi-agent coordination
- [ ] Monitoring dashboard
- [ ] Self-hosted alternative (no external dependency)

## See Also

- [Full Documentation](../../docs/PUBNUB_INTEGRATION.md)
- [Quick Start Guide](../../docs/PUBNUB_QUICKSTART.md)
- [Main README](../../README.md)
