# Claude Recall MCP Analysis

## Repository Structure Overview
- Main language: TypeScript (80.2%), JavaScript (19.2%), Shell (0.6%)
- 23 commits, 7 tags
- Key directories:
  - `.claude-flow/` - Likely contains Claude Flow configuration
  - `.devcontainer/` - Development container setup
  - `claude-flow-tool/` - Main MCP tool implementation
  - `project/` - Project files
  - `references/` - Reference materials
- Key files:
  - `README.md` - Minimal, just contains title "claude-recall"
  - `package.json` - Node.js project configuration
  - `claude-recall.db` - Database file
  - `.gitmodules` - Git submodules configuration

## Initial Observations
- The repository appears to be an MCP tool implementation for Claude
- The name suggests it's related to memory/recall functionality
- Multiple directories suggest a structured MCP tool setup



## Package.json Analysis
```json
{
  "dependencies": {
    "perplexity-mcp": "^0.2.0"
  }
}
```

**Key Finding**: The project depends on `perplexity-mcp` version 0.2.0, which suggests this is an MCP tool that integrates with Perplexity AI services.


## Claude Flow Swarm Configuration

The `.claude-flow/` directory contains a sophisticated multi-agent system configuration:

### Agent Roles:
- **Coordinator**: Main orchestration and quality assurance
- **Agent-Researcher**: Investigation and analysis lead  
- **Agent-Architect**: System design and architecture lead
- **Agent-Coder-1**: Core implementation lead
- **Agent-Coder-2**: Testing and integration lead

### Key Features:
- **Memory Storage Integration**: Persistent storage in swarm coordination system
- **Natural Language Processing**: Handles preferences like "hey, lets put tests in test-new from now on"
- **SemanticPreferenceExtractor**: Core component for processing semantic intent
- **HTML Marker Migration**: Moving away from HTML injection to semantic processing

### Success Criteria:
- Natural language preferences processed correctly
- No breaking changes to existing preference storage
- HTML marker injection removed
- All existing tests pass
- Performance maintained or improved


## MCP Server Configuration (project/package.json)

```json
{
  "name": "claude-recall",
  "version": "0.2.10",
  "description": "MCP server for persistent memory in Claude Code conversations",
  "main": "dist/index.js",
  "bin": {
    "claude-recall": "dist/cli/claude-recall-cli.js"
  },
  "files": [
    "dist/",
    "scripts/postinstall.js",
    "README.md",
    "LICENSE",
    "docs/"
  ],
  "directories": {
    "doc": "docs",
    "test": "tests"
  },
  "scripts": {
    "postinstall": "node scripts/postinstall.js || true",
    "test": "jest --passWithNoTests",
    "test:watch": "jest --watch",
    "build": "tsc && mkdir -p dist/memory dist/config && cp src/memory/schema.sql dist/memory/ && cp src/config/memory-patterns.json dist/config/",
    "build:cli": "tsc && chmod +x dist/cli/claude-recall-cli.js",
    "dev": "ts-node",
    "start": "ts-node src/server.ts",
    "start:dev": "nodemon --exec ts-node src/server.ts",
    "claude-recall": "ts-node src/cli/claude-recall-cli.ts",
    "install:global": "npm run build && npm link",
    "stats": "npm run claude-recall stats",
    "search": "npm run claude-recall search",
    "migrate:service-layer": "ts-node migrate-to-service-layer.ts",
    "rollback:service-layer": "ts-node -e 'require(\"./migrate-to-service-layer\").ServiceLayerMigration.rollback()'",
    "preuninstall": "node scripts/uninstall.js",
    "prepare": "npm run build",
    "mcp:start": "node dist/cli/claude-recall-cli.js mcp start"
  }
}
```

### Key MCP Configuration Points:
1. **Binary Entry**: `claude-recall` command points to `dist/cli/claude-recall-cli.js`
2. **MCP Server Start**: `mcp:start` script runs the MCP server
3. **Main Entry**: `dist/index.js` is the main module
4. **Post-install**: Automatic configuration via `scripts/postinstall.js`
5. **Build Process**: TypeScript compilation with schema and config file copying


## MCP Server Implementation (src/mcp/server.ts)

### Key Imports:
```typescript
import { StdioTransport } from './transports/stdio';
import { MemoryTools } from './tools/memory-tools';
import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { SessionManager } from './session-manager';
import { RateLimiter } from './rate-limiter';
import { MemoryCaptureMiddleware } from './memory-capture-middleware';
```

### MCP Interfaces:
```typescript
export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (input: any, context: MCPContext) => Promise<any>;
}

export interface MCPContext {
  sessionId: string;
  timestamp: number;
  projectId?: string;
}
```

### MCPServer Class Structure:
```typescript
export class MCPServer {
  private transport: StdioTransport;
  private tools: Map<string, MCPTools> = new Map();
  private memoryService: MemoryService;
  private logger: LoggingService;
  private sessions: Map<string, MCPContext> = new Map();
  private sessionManager: SessionManager;
  private rateLimiter: RateLimiter;
  private memoryCaptureMiddleware: MemoryCaptureMiddleware;
  private isInitialized = false;

  constructor() {
    this.transport = new StdioTransport();
    this.memoryService = MemoryService.getInstance();
    this.logger = LoggingService.getInstance();
    this.sessionManager = new SessionManager(this.logger);
    this.rateLimiter = new RateLimiter(this.logger, {
      windows: 60000,     // 1 minute
      maxRequests: 100,   // 100 requests per minute
      skipSuccessfulRequests: false
    });
    this.memoryCaptureMiddleware = new MemoryCaptureMiddleware();
    
    this.setupRequestHandlers();
    this.registerTools();
  }
}
```

### Request Handling:
- **initialize**: Handles MCP server initialization
- **tools/list**: Returns available MCP tools
- Rate limiting with 100 requests per minute
- Session management for context tracking
- Memory capture middleware for automatic memory storage


## MCP Tool Definitions (src/mcp/tools/memory-tools.ts)

### MemoryTools Class Structure:
```typescript
export class MemoryTools {
  private tools: MCPTool[] = [];
  private searchMonitor: SearchMonitor;

  constructor(
    private memoryService: MemoryService,
    private logger: LoggingService
  ) {
    this.searchMonitor = SearchMonitor.getInstance();
    this.registerTools();
  }
}
```

### MCP Tool Registration Pattern:
Each MCP tool is defined with:
1. **name**: Unique identifier (e.g., "mcp__claude-recall__store_memory")
2. **description**: Human-readable description
3. **inputSchema**: JSON schema defining input parameters
4. **handler**: Async function that processes the tool call

### Available MCP Tools:

#### 1. Store Memory Tool
```typescript
{
  name: 'mcp__claude-recall__store_memory',
  description: 'Store a memory in Claude Recall',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Memory content to store'
      },
      metadata: {
        type: 'object',
        description: 'Optional metadata for the memory'
      }
    },
    required: ['content']
  },
  handler: this.handleStoreMemory.bind(this)
}
```

#### 2. Retrieve Memory Tool
```typescript
{
  name: 'mcp__claude-recall__retrieve_memory',
  description: 'Get relevant memories by ID or query',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query to find relevant memories'
      },
      id: {
        type: 'string',
        description: 'Specific memory ID to retrieve'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of memories to return (default: 10)'
      }
    }
  },
  handler: this.handleRetrieveMemory.bind(this)
}
```

#### 3. Search Tool
```typescript
{
  name: 'mcp__claude-recall__search',
  description: 'Search through all memories',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query'
      },
      filters: {
        type: 'object',
        description: 'Optional filters to apply',
        properties: {
          type: {
            type: 'string',
            description: 'Filter by memory type'
          },
          projectId: {
            type: 'string',
            description: 'Filter by project ID'
          }
        }
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results (default: 20)'
      }
    },
    required: ['query']
  },
  handler: this.handleSearch.bind(this)
}
```

### Tool Execution Pattern:
```typescript
private async executeToolWithTracking(
  tool: MCPTool,
  input: any,
  context: MCPContext
): Promise<any> {
  const startTime = Date.now();
  const toolMeta = {
    name: tool.name,
    sessionId: context.sessionId,
    startTime
  };

  try {
    // Validate input against schema
    this.validateInput(tool.inputSchema, input);
    
    // Execute tool
    const result = await tool.handler(input, context);
    
    // Track success
    this.logger.info('ToolExecution', 'Tool completed', {
      ...toolMeta,
      duration: Date.now() - startTime,
      success: true
    });
    
    return result;
  } catch (error) {
    // Track failure
    this.logger.error('ToolExecution', 'Tool failed', {
      ...toolMeta,
      error: (error as Error).message
    });
    throw error;
  }
}
```


## How Claude Code Invokes MCP Tools

### Claude Instructions (project/CLAUDE.md)
The CLAUDE.md file provides instructions to Claude on how to use the memory system:

> Claude Recall captures tool usage and user preferences, storing them in SQLite for intelligent retrieval in future Claude sessions.

### Key Integration Points:

#### 1. Automatic Memory Search
According to the README, Claude Recall implements automatic context loading:
- **Automatic Context Loading**: Claude searches memory on EVERY prompt to provide context-aware responses
- **Silent Memory Storage**: Memories are stored without mentioning it
- **Natural Integration**: Retrieved information is used as if Claude always knew it

#### 2. Tool Invocation Patterns
Claude invokes MCP tools using the standard MCP protocol format:
```typescript
// Example tool invocation
await mcp__claude-recall__store_memory({
  content: "Always use 2 spaces for indentation in this project",
  metadata: { type: "preference", project: "my-app" }
})

// Search invocation
const memories = await mcp__claude-recall__search({
  query: "database",
  limit: 10
})
```

#### 3. Natural Language Triggers
The system detects specific patterns in user messages to trigger memory operations:

**Memory Storage Triggers:**
- "recall" (when used for storing, e.g., "for recall later")
- "remember" / "remember that" / "please remember"
- "don't forget" / "keep in mind" / "bear in mind"
- "store in memory" / "save to memory"
- "note that" / "take note"
- "for future reference" / "memorize"

**Memory Retrieval Triggers:**
- "recall" / "recall what I said about"
- "what did I tell you about"
- "what do you remember about"
- "do you remember"

**Automatic Pattern Detection:**
- **Preferences**: "I prefer X over Y", "Always use X", "From now on, use Y"
- **Decisions**: "We decided to...", "Let's go with...", "We'll use..."
- **Instructions**: "Make sure to...", "Ensure that...", "Files should be in..."

## MCP Server Configuration and Deployment

### Installation and Configuration Process
The npm installation automatically:
1. Installs the Claude Recall CLI globally
2. Configures the MCP server in `~/.claude.json` file
3. Creates a database directory at `~/.claude-recall/`
4. Updates `~/CLAUDE.md` with global instructions for Claude to use memory tools
5. Sets up the proper command structure for Claude Code integration

### MCP Server Entry Points
```json
{
  "bin": {
    "claude-recall": "dist/cli/claude-recall-cli.js"
  },
  "scripts": {
    "mcp:start": "node dist/cli/claude-recall-cli.js mcp start"
  }
}
```

### Transport Layer
The MCP server uses StdioTransport for communication:
```typescript
import { StdioTransport } from './transports/stdio';

export class MCPServer {
  private transport: StdioTransport;
  
  constructor() {
    this.transport = new StdioTransport();
    // ... other initialization
  }
}
```

### Session Management and Rate Limiting
```typescript
constructor() {
  this.sessionManager = new SessionManager(this.logger);
  this.rateLimiter = new RateLimiter(this.logger, {
    windows: 60000,     // 1 minute
    maxRequests: 100,   // 100 requests per minute
    skipSuccessfulRequests: false
  });
}
```

## Memory Capture Middleware

The system includes sophisticated middleware for automatic memory capture:
```typescript
this.memoryCaptureMiddleware = new MemoryCaptureMiddleware();
```

This middleware automatically detects and stores relevant information from Claude conversations without explicit user commands.

## Database Architecture

### Storage Location
- **Database Path**: `~/.claude-recall/claude-recall.db`
- **Database Type**: SQLite for fast, reliable local storage
- **Schema**: Defined in `src/memory/schema.sql`

### Memory Management
- **Auto-compaction**: When database exceeds 10MB
- **Memory limits**: Maximum 10,000 memories (older entries are cleaned up)
- **Smart retention**: Preferences and project knowledge are kept forever
- **Tool-use history**: Limited to most recent 1,000 entries

## Complete MCP Tool Reference

### Available Tools Summary

| Tool Name | Purpose | Required Parameters | Optional Parameters |
|-----------|---------|-------------------|-------------------|
| `mcp__claude-recall__store_memory` | Store new memory | `content` | `metadata` |
| `mcp__claude-recall__retrieve_memory` | Get specific memories | - | `query`, `id`, `limit` |
| `mcp__claude-recall__search` | Search all memories | `query` | `filters`, `limit` |
| `mcp__claude-recall__get_stats` | View memory statistics | - | - |
| `mcp__claude-recall__clear_context` | Clear session context | - | - |

### Tool Handler Implementation Pattern
Each tool handler follows this pattern:
1. **Input Validation**: Validate against JSON schema
2. **Service Layer Call**: Delegate to appropriate service
3. **Error Handling**: Catch and log errors
4. **Response Formatting**: Return structured response
5. **Tracking**: Log execution metrics

## Integration with Claude Code

### MCP Protocol Communication
The server communicates with Claude Code using the standard MCP protocol:
- **Request Format**: JSON-RPC 2.0 with method and parameters
- **Response Format**: JSON-RPC 2.0 with result or error
- **Transport**: Standard I/O (stdin/stdout)

### Tool Discovery
Claude Code discovers available tools through the `tools/list` MCP method, which returns the complete tool registry with schemas.

### Context Management
Each tool execution includes context information:
```typescript
interface MCPContext {
  sessionId: string;
  timestamp: number;
  projectId?: string;
}
```

This context enables the system to maintain session state and project-specific memories across tool invocations.

