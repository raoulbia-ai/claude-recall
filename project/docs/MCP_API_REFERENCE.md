# Claude Recall MCP API Reference

## Protocol Version
- JSON-RPC 2.0
- MCP Protocol Version: 2024-11-05

## Tools

### mcp__claude-recall__store_memory

Stores a memory in the Claude Recall database.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "content": {
      "type": "string",
      "description": "Memory content to store"
    },
    "metadata": {
      "type": "object",
      "description": "Optional metadata for the memory"
    }
  },
  "required": ["content"]
}
```

**Output:**
```json
{
  "id": "memory_1234567890_abc123",
  "success": true,
  "message": "Memory stored successfully"
}
```

### mcp__claude-recall__search

Searches memories using natural language query.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query"
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of results",
      "default": 10
    },
    "threshold": {
      "type": "number",
      "description": "Minimum similarity score (0-1)",
      "default": 0.7
    }
  },
  "required": ["query"]
}
```

**Output:**
```json
{
  "results": [
    {
      "id": "memory_1234567890_abc123",
      "content": "Memory content",
      "metadata": {},
      "timestamp": "2024-01-01T00:00:00Z",
      "score": 0.95
    }
  ],
  "total": 1,
  "query": "search query"
}
```

### mcp__claude-recall__retrieve_memory

Retrieves specific memories by ID or recent memories.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Memory ID to retrieve"
    },
    "limit": {
      "type": "number",
      "description": "Number of recent memories to retrieve",
      "default": 10
    }
  }
}
```

**Output:**
```json
{
  "memories": [
    {
      "id": "memory_1234567890_abc123",
      "content": "Memory content",
      "metadata": {},
      "timestamp": "2024-01-01T00:00:00Z",
      "sessionId": "session_123"
    }
  ],
  "total": 1
}
```

### mcp__claude-recall__get_stats

Returns memory usage statistics.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {}
}
```

**Output:**
```json
{
  "totalMemories": 100,
  "sessionMemories": 25,
  "memoryTypes": {
    "general": 50,
    "code": 30,
    "conversation": 20
  },
  "lastMemoryTimestamp": "2024-01-01T00:00:00Z",
  "sessionStartTime": "2024-01-01T00:00:00Z",
  "databaseSize": "1.5 MB"
}
```

### mcp__claude-recall__clear_context

Clears session-specific context memories.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "confirm": {
      "type": "boolean",
      "description": "Confirmation required to clear context"
    }
  }
}
```

**Output:**
```json
{
  "success": true,
  "message": "Context cleared successfully",
  "memoriesCleared": 10
}
```

## Health Check

### Method: health/check

Returns server health information.

**Response:**
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "memory": {
    "heapUsed": 50331648,
    "heapTotal": 68157440,
    "external": 2097152,
    "rss": 104857600
  },
  "sessions": {
    "total": 10,
    "active": 2
  },
  "toolsRegistered": 5,
  "database": "connected",
  "rateLimiter": {
    "requestsPerMinute": 100,
    "currentRequests": 15
  }
}
```

## Error Responses

All errors follow the JSON-RPC 2.0 error format:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": {
      "details": "Additional error information"
    }
  }
}
```

### Common Error Codes
- `-32700`: Parse error
- `-32600`: Invalid request
- `-32601`: Method not found
- `-32602`: Invalid params
- `-32603`: Internal error
- `-32000`: Tool not found
- `-32001`: Rate limit exceeded
- `-32002`: Database error

## Transport

The MCP server uses stdio transport:
- Input: stdin (JSON-RPC requests)
- Output: stdout (JSON-RPC responses)
- Errors: stderr (logging and diagnostics)

## Session Management

Sessions are automatically managed by the server:
- Session ID is generated on first connection
- Sessions persist across server restarts
- Session data stored in `~/.claude-recall/sessions.json`
- Memories are associated with sessions for context

## Rate Limiting

Default rate limiting configuration:
- 100 requests per minute per session
- Sliding window algorithm
- Rate limit resets after 60 seconds
- Custom limits via `CLAUDE_RECALL_RATE_LIMIT` environment variable