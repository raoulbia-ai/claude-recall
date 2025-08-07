# Claude Recall API Reference

## Overview

Claude Recall provides both automatic memory management and programmatic APIs for memory operations. The system works primarily through automatic capture and retrieval, but also exposes APIs for direct interaction.

## Automatic Memory System

### Hook Events
The system automatically processes these events:

#### user-prompt
- **Triggered**: When user submits a prompt to Claude
- **Processing**: Extracts preferences and searches for relevant memories
- **Queue**: `hook-events`

#### tool-use
- **Triggered**: When Claude uses tools
- **Processing**: Captures tool usage patterns
- **Queue**: `hook-events`

## JavaScript/TypeScript API

### MemoryService

```typescript
import { MemoryService } from 'claude-recall';

const memoryService = MemoryService.getInstance();
```

#### store(memory)
Store a new memory.

```typescript
memoryService.store({
  key: 'unique-key',
  value: JSON.stringify({ content: 'User prefers TypeScript' }),
  content: 'User prefers TypeScript',
  type: 'preference',
  metadata: { category: 'coding-style' }
});
```

#### search(query)
Search for relevant memories.

```typescript
const results = memoryService.search('TypeScript preferences');
// Returns: Array of scored memories
```

#### retrieve(key)
Get a specific memory by key.

```typescript
const memory = memoryService.retrieve('unique-key');
```

### QueueAPI

```typescript
import { QueueAPI } from 'claude-recall';

const queueAPI = QueueAPI.getInstance();
```

#### enqueueHookEvent(type, payload)
Queue a hook event for processing.

```typescript
await queueAPI.enqueueHookEvent('user-prompt', {
  prompt: 'What database should I use?',
  timestamp: Date.now()
});
```

#### getSystemHealth()
Check system health status.

```typescript
const health = await queueAPI.getSystemHealth();
// Returns: { isHealthy: boolean, totalPendingMessages: number, ... }
```

## CLI API

### Search Command
```bash
claude-recall search [query] [options]

Options:
  --limit <n>     Maximum results to return (default: 10)
  --type <type>   Filter by memory type
  --verbose       Show detailed output
```

### Stats Command
```bash
claude-recall stats

Output:
  Total memories: X
  By type: preferences (X), corrections (X), ...
```

### Export Command
```bash
claude-recall export <output> [options]

Options:
  --format <fmt>  Output format: json|csv (default: json)
  --type <type>   Export only specific type
```

### Import Command
```bash
claude-recall import <input> [options]

Options:
  --merge         Merge with existing memories
  --overwrite     Replace existing memories
```

### Clear Command
```bash
claude-recall clear [options]

Options:
  --type <type>   Clear only specific type
  --days <n>      Clear memories older than n days
  --all           Clear all memories (requires confirmation)
```

## Memory Schema

### Memory Object
```typescript
interface Memory {
  key: string;              // Unique identifier
  value: string;            // JSON stringified content
  content: string;          // Human-readable content
  type: MemoryType;         // Category of memory
  metadata?: object;        // Additional context
  timestamp: number;        // Creation time
  project_id?: string;      // Associated project
  relevance_score?: number; // Importance score
}
```

### Memory Types
```typescript
type MemoryType = 
  | 'preference'          // User preferences
  | 'correction'          // Learned corrections
  | 'project_knowledge'   // Project-specific info
  | 'tool_use'           // Tool usage patterns
  | 'context'            // Current context
  | 'pattern'            // Detected patterns
```

## Queue System

### Queue Names
- `hook-events` - User prompts and tool usage
- `mcp-operations` - MCP protocol operations
- `memory-extraction` - Preference extraction tasks

### Queue Message Status
- `pending` - Waiting to be processed
- `processing` - Currently being processed
- `completed` - Successfully processed
- `failed` - Processing failed
- `retrying` - Failed but will retry

## Database Location

### Default Path
```
~/.claude-recall/claude-recall.db
```

### Database Tables
- `memories` - Main memory storage
- `queue_messages` - Queue system messages
- `queue_configs` - Queue configurations
- `dead_letter_queue` - Failed messages

## Environment Variables

```bash
# Database location
CLAUDE_RECALL_DB_PATH=/custom/path

# Database name
CLAUDE_RECALL_DB_NAME=custom.db

# Logging
CLAUDE_RECALL_LOG_LEVEL=debug|info|warn|error
CLAUDE_RECALL_LOG_DIR=/custom/logs

# Memory settings
CLAUDE_RECALL_MAX_RETRIEVAL=10
CLAUDE_RECALL_RELEVANCE_THRESHOLD=0.3
```

## Error Codes

| Code | Description |
|------|-------------|
| MEM001 | Memory storage failed |
| MEM002 | Memory retrieval failed |
| QUE001 | Queue enqueue failed |
| QUE002 | Queue processing failed |
| DB001 | Database connection failed |
| DB002 | Database operation failed |

## Rate Limits

- Memory searches: Unlimited (local)
- Memory storage: Limited by disk space
- Queue processing: ~1000 msg/sec
- Batch operations: 100 items max

## WebSocket Events (Future)

*Coming in v0.3.0*

```javascript
socket.on('memory:stored', (memory) => {});
socket.on('memory:retrieved', (memories) => {});
socket.on('queue:processed', (message) => {});
```

---
*API Reference v0.2.18 - Last updated: August 2025*