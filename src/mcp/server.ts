import { StdioTransport } from './transports/stdio';
import { MemoryTools } from './tools/memory-tools';
import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { SessionManager } from './session-manager';
import { RateLimiter } from './rate-limiter';
import { ResourcesHandler } from './resources-handler';
import { PromptsHandler } from './prompts-handler';
import { ProcessManager } from '../services/process-manager';
import { ConfigService } from '../services/config';
import { ProjectRegistry } from '../services/project-registry';
import * as path from 'path';
import * as fs from 'fs';

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

export class MCPServer {
  private transport: StdioTransport;
  private tools: Map<string, MCPTool> = new Map();
  private memoryService: MemoryService;
  private logger: LoggingService;
  private sessionManager: SessionManager;
  private rateLimiter: RateLimiter;
  private resourcesHandler: ResourcesHandler;
  private promptsHandler: PromptsHandler;
  private processManager: ProcessManager;
  private config: ConfigService;
  // One stdio server serves exactly one client — all tool calls without an
  // explicit sessionId belong to this per-process session.
  private readonly processSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  constructor() {
    this.transport = new StdioTransport();
    this.memoryService = MemoryService.getInstance();
    this.logger = LoggingService.getInstance();
    this.config = ConfigService.getInstance();
    // Scope the session file per project so concurrent servers don't clobber
    // each other's sessions.json (last-writer-wins).
    this.sessionManager = new SessionManager(this.logger, this.config.getProjectId());
    this.rateLimiter = new RateLimiter(this.logger, {
      windowMs: 60000,      // 1 minute
      maxRequests: 100,     // 100 requests per minute
      skipSuccessfulRequests: false
    });
    this.resourcesHandler = new ResourcesHandler();
    this.promptsHandler = new PromptsHandler();
    this.processManager = ProcessManager.getInstance();

    this.setupRequestHandlers();
    this.registerTools();
  }

  private setupRequestHandlers(): void {
    this.transport.onRequest(async (request: MCPRequest): Promise<MCPResponse> => {
      let response: MCPResponse;
      try {
        switch (request.method) {
          case 'initialize':
            response = await this.handleInitialize(request);
            break;
          case 'tools/list':
            response = await this.handleToolsList(request);
            break;
          case 'tools/call':
            response = await this.handleToolCall(request);
            break;
          case 'ping':
            response = { jsonrpc: "2.0", id: request.id, result: {} };
            break;
          case 'resources/list':
            response = await this.resourcesHandler.handleResourcesList(request);
            break;
          case 'resources/read':
            response = await this.resourcesHandler.handleResourcesRead(request);
            break;
          case 'prompts/list':
            response = await this.promptsHandler.handlePromptsList(request);
            break;
          case 'prompts/get':
            response = await this.promptsHandler.handlePromptsGet(request);
            break;
          default:
            response = this.createErrorResponse(request.id, -32601, `Method not found: ${request.method}`);
        }
      } catch (error) {
        this.logger.logServiceError('MCPServer', 'handleRequest', error as Error, { method: request.method });
        response = this.createErrorResponse(
          request.id,
          -32603,
          'Internal error',
          { message: (error as Error).message }
        );
      }

      return response;
    });

    // Notifications have no id and never get a response. Per the MCP spec the
    // client signals handshake completion with `notifications/initialized`.
    this.transport.onNotification(async (notification) => {
      if (notification.method === 'notifications/initialized') {
        this.logger.info('MCPServer', 'MCP server initialized successfully');
      }
    });

    // stdin EOF means Claude Code exited. A stdio server has exactly one
    // client, so shut down instead of lingering as an orphaned process.
    this.transport.onClose(() => {
      this.logger.info('MCPServer', 'Client disconnected (stdin closed), shutting down');
      this.stop()
        .catch(error => this.logger.logServiceError('MCPServer', 'stop', error as Error))
        .finally(() => process.exit(0));
    });
  }

  private registerTools(): void {
    const memoryTools = new MemoryTools(this.memoryService, this.logger, () => {
      this.sendPromptsChanged();
    });

    // Register memory tools (always: load_rules + store_memory)
    for (const tool of memoryTools.getTools()) {
      this.tools.set(tool.name, tool);
    }

    this.logger.info('MCPServer', `Registered ${this.tools.size} tools`, {
      tools: Array.from(this.tools.keys())
    });
  }

  /**
   * Send prompts/list_changed notification to inform CC that prompts may have new data.
   */
  private sendPromptsChanged(): void {
    // Non-critical — CC will still work without it. sendNotification is
    // async, so a try/catch here would never see its rejection.
    this.transport.sendNotification({
      jsonrpc: '2.0',
      method: 'notifications/prompts/list_changed',
    }).catch(() => { /* ignore */ });
  }

  private async handleInitialize(request: MCPRequest): Promise<MCPResponse> {
    const params = request.params || {};

    this.logger.info('MCPServer', 'Initializing MCP server', params);

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {}
        },
        serverInfo: {
          name: "claude-recall",
          version: this.getVersion()
        }
      }
    };
  }

  private async handleToolsList(request: MCPRequest): Promise<MCPResponse> {
    const toolList = Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));

    this.logger.debug('MCPServer', `Listing ${toolList.length} tools`);

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: {
        tools: toolList
      }
    };
  }

  private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
    const { name, arguments: toolArgs } = request.params || {};

    if (!name || typeof name !== 'string') {
      return this.createErrorResponse(request.id, -32602, 'Invalid params: tool name required');
    }

    const tool = this.tools.get(name);
    if (!tool) {
      return this.createErrorResponse(request.id, -32601, `Tool not found: ${name}`);
    }

    const startTime = Date.now();

    // Stable session identity: a stdio server has exactly one client for its
    // whole lifetime, so all calls belong to one session unless the client
    // explicitly passes sessionId (no registered tool schema declares it, so
    // in practice this is always the per-process id). The previous fallback
    // generated a FRESH random id per call — a new session and a full
    // sessions.json write for every tool call, and a rate limiter that saw
    // one request per "session" and therefore could never trigger.
    const sessionId = toolArgs?.sessionId || this.processSessionId;

    try {
      // Get or create session
      let session = this.sessionManager.getSession(sessionId);
      if (!session) {
        session = this.sessionManager.createSession(sessionId);
      }

      // Check rate limit
      const withinLimit = await this.rateLimiter.checkLimit(sessionId);
      if (!withinLimit) {
        const remaining = this.rateLimiter.getRemainingRequests(sessionId);
        return this.createErrorResponse(
          request.id,
          -32000, // Custom error code for rate limit
          'Rate limit exceeded',
          {
            sessionId,
            remainingRequests: remaining,
            windowMs: 60000,
            message: 'Too many requests. Please wait before trying again.'
          }
        );
      }
      
      // Update session activity
      this.sessionManager.incrementToolCalls(sessionId);
      
      const context: MCPContext = {
        sessionId,
        timestamp: Date.now(),
        projectId: toolArgs?.projectId
      };

      this.logger.info('MCPServer', `Executing tool: ${name}`, {
        sessionId,
        args: toolArgs,
        toolCallCount: session.toolCalls
      });

      const result = await tool.handler(toolArgs || {}, context);

      // Record successful request for rate limiting
      this.rateLimiter.recordRequest(sessionId, true);

      // Claude-flow pattern: Enhanced response format
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
            }
          ],
          isError: false,
          metadata: {
            toolName: name,
            duration: Date.now() - startTime,
            sessionId: context.sessionId
          }
        }
      };
    } catch (error) {
      this.logger.logServiceError('MCPServer', `tool:${name}`, error as Error, toolArgs);

      // Record failed request for rate limiting (same session as the attempt)
      this.rateLimiter.recordRequest(sessionId, false);

      // Claude-flow pattern: Enhanced error response
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          content: [
            {
              type: "text",
              text: `Tool execution failed: ${(error as Error).message}`
            }
          ],
          isError: true,
          metadata: {
            toolName: name,
            duration: Date.now() - startTime,
            sessionId,
            error: {
              message: (error as Error).message
              // Stack trace intentionally omitted from the wire response —
              // exposes internal file paths and code structure. Full stack
              // is still captured by logServiceError() for local diagnosis
              // (audit 2026-04-23 deferred item).
            }
          }
        }
      };
    }
  }

  private createErrorResponse(
    id: string | number,
    code: number,
    message: string,
    data?: any
  ): MCPResponse {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
        ...(data && { data })
      }
    };
  }

  async start(): Promise<void> {
    try {
      this.logger.info('MCPServer', 'Starting Claude Recall MCP server...');

      // Get project ID for PID tracking
      const projectId = this.config.getProjectId();

      // Auto-register project in registry
      const rootDir = this.config.getConfig().project.rootDir;
      const version = this.getVersion();
      const projectRegistry = ProjectRegistry.getInstance();

      projectRegistry.register(projectId, rootDir, version);
      projectRegistry.updateLastSeen(projectId);

      this.logger.debug('MCPServer', `Project registered: ${projectId} at ${rootDir} (v${version})`);

      // Check for existing MCP server process and auto-cleanup
      const existingPid = this.processManager.readPidFile(projectId);

      if (existingPid) {
        if (this.processManager.isProcessRunning(existingPid)) {
          // Always auto-cleanup stale processes (no longer requires env var)
          this.logger.warn('MCPServer', `Stopping existing MCP server (PID: ${existingPid}) before starting...`);
          this.processManager.killProcess(existingPid, false);
          // Wait until it has actually exited — its graceful stop (session
          // persist + WAL checkpoint + DB close) can take more than a second
          const deadline = Date.now() + 5000;
          while (this.processManager.isProcessRunning(existingPid) && Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          if (this.processManager.isProcessRunning(existingPid)) {
            this.logger.warn('MCPServer', `Old server (PID: ${existingPid}) did not exit in time, force killing`);
            this.processManager.killProcess(existingPid, true);
          }
          this.processManager.removePidFile(projectId);
        } else {
          // Clean up stale PID file
          this.logger.info('MCPServer', 'Removing stale PID file...');
          this.processManager.removePidFile(projectId);
        }
      }

      await this.transport.start();

      // Write PID file after successful startup
      this.processManager.writePidFile(projectId, process.pid);
      this.logger.info('MCPServer', `MCP server started successfully (PID: ${process.pid}, Project: ${projectId})`);

      // Prune stale rules (loaded often, never cited) from load_rules payload.
      // Gated on CLAUDE_RECALL_AUTO_DEMOTE=true. Idempotent; safe per-boot.
      const demoted = this.memoryService.autoDemoteStaleRules();
      if (demoted.length > 0) {
        this.logger.info('MCPServer', `Auto-demoted ${demoted.length} stale rules on boot`);
      }

      // Auto-compaction: enforce the documented size/count thresholds and
      // retention limits. Non-fatal — a failed compaction (e.g. VACUUM busy)
      // must never prevent the server from starting.
      try {
        const { DatabaseManager } = await import('../services/database-manager');
        const dbManager = DatabaseManager.getInstance();
        if (await dbManager.shouldCompact()) {
          const result = await dbManager.compact();
          this.logger.info('MCPServer', 'Auto-compaction completed on boot', {
            removed: result.removedCount,
            deduplicated: result.deduplicatedCount,
            savedBytes: result.beforeSize - result.afterSize,
          });
        }
      } catch (error) {
        this.logger.logServiceError('MCPServer', 'autoCompact', error as Error);
      }
    } catch (error) {
      this.logger.logServiceError('MCPServer', 'start', error as Error);
      throw error;
    }
  }

  private isStopping = false;

  async stop(): Promise<void> {
    // Idempotent: stop() can be reached from stdin close, SIGINT and SIGTERM
    if (this.isStopping) {
      return;
    }
    this.isStopping = true;

    try {
      this.logger.info('MCPServer', 'Stopping MCP server...');

      // Clean up old sessions before shutdown
      this.sessionManager.cleanupOldSessions();

      // Shutdown session manager (persists sessions)
      this.sessionManager.shutdown();

      // Shutdown rate limiter
      this.rateLimiter.shutdown();

      await this.transport.stop();
      this.memoryService.close();

      // Remove PID file on clean shutdown — but only if it still belongs to
      // this process. A replacement server may already have written its own.
      const projectId = this.config.getProjectId();
      this.processManager.removePidFile(projectId, process.pid);

      this.logger.info('MCPServer', 'MCP server stopped');
    } catch (error) {
      this.logger.logServiceError('MCPServer', 'stop', error as Error);
      throw error;
    }
  }

  // Graceful shutdown handling
  setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      this.logger.info('MCPServer', `Received ${signal}, shutting down gracefully...`);
      try {
        await this.stop();
      } catch (error) {
        this.logger.logServiceError('MCPServer', 'stop', error as Error);
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => { void shutdown('SIGINT'); });
    process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  }

  /**
   * Get current version from package.json
   */
  private getVersion(): string {
    try {
      const packageJsonPath = path.join(__dirname, '../../package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version;
    } catch (error) {
      return 'unknown';
    }
  }

}