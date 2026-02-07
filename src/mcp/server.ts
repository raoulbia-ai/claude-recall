import { StdioTransport } from './transports/stdio';
import { MemoryTools } from './tools/memory-tools';
import { TestTools } from './tools/test-tools';
import { LiveTestingTools } from './tools/live-testing-tools';
import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { SessionManager } from './session-manager';
import { RateLimiter } from './rate-limiter';
import { MemoryCaptureMiddleware } from './memory-capture-middleware';
import { QueueIntegrationService } from '../services/queue-integration';
import { ResourcesHandler } from './resources-handler';
import { PromptsHandler } from './prompts-handler';
import { ConversationContextManager } from '../services/conversation-context-manager';
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
  private sessions: Map<string, MCPContext> = new Map();
  private sessionManager: SessionManager;
  private rateLimiter: RateLimiter;
  private memoryCaptureMiddleware: MemoryCaptureMiddleware;
  private queueIntegration: QueueIntegrationService;
  private resourcesHandler: ResourcesHandler;
  private promptsHandler: PromptsHandler;
  private conversationContext: ConversationContextManager;
  private processManager: ProcessManager;
  private config: ConfigService;
  private isInitialized = false;
  private parentPid: number | null = null;
  private parentCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.transport = new StdioTransport();
    this.memoryService = MemoryService.getInstance();
    this.logger = LoggingService.getInstance();
    this.sessionManager = new SessionManager(this.logger);
    this.rateLimiter = new RateLimiter(this.logger, {
      windowMs: 60000,      // 1 minute
      maxRequests: 100,     // 100 requests per minute
      skipSuccessfulRequests: false
    });
    this.memoryCaptureMiddleware = new MemoryCaptureMiddleware();
    this.queueIntegration = QueueIntegrationService.getInstance();
    this.resourcesHandler = new ResourcesHandler();
    this.promptsHandler = new PromptsHandler();
    this.conversationContext = ConversationContextManager.getInstance();
    this.processManager = ProcessManager.getInstance();
    this.config = ConfigService.getInstance();

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
          case 'notifications/initialized':
            response = await this.handleInitialized(request);
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
          case 'health/check':
            response = await this.handleHealthCheck(request);
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

      // Process for automatic memory capture (non-blocking)
      if (this.isInitialized && request.method === 'tools/call') {
        const sessionId = request.params?.arguments?.sessionId || this.generateSessionId();
        this.memoryCaptureMiddleware.processForMemoryCapture(request, response, sessionId)
          .catch(err => this.logger.error('MCPServer', 'Memory capture failed', err));
      }

      return response;
    });
  }

  private registerTools(): void {
    const memoryTools = new MemoryTools(this.memoryService, this.logger);

    // Register memory tools (always: load_rules + store_memory)
    for (const tool of memoryTools.getTools()) {
      this.tools.set(tool.name, tool);
    }

    // Register test/live-testing tools only when explicitly enabled
    if (process.env.CLAUDE_RECALL_ENABLE_TEST_TOOLS === 'true') {
      const testTools = new TestTools(this.memoryService, this.logger);
      const liveTestingTools = new LiveTestingTools();

      for (const tool of testTools.getTools()) {
        this.tools.set(tool.name, tool);
      }

      for (const toolDef of liveTestingTools.getToolDefinitions()) {
        const tool: MCPTool = {
          name: toolDef.name,
          description: toolDef.description,
          inputSchema: {
            type: "object",
            properties: toolDef.parameters.properties,
            required: toolDef.parameters.required
          },
          handler: async (input: any, context: MCPContext) => {
            return await liveTestingTools.handleToolCall(toolDef.name, input);
          }
        };
        this.tools.set(tool.name, tool);
      }

      this.logger.info('MCPServer', `Test tools enabled: registered ${this.tools.size} tools`);
    }

    this.logger.info('MCPServer', `Registered ${this.tools.size} tools`, {
      tools: Array.from(this.tools.keys())
    });
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
          version: "0.2.0"
        }
      }
    };
  }

  private async handleInitialized(request: MCPRequest): Promise<MCPResponse> {
    this.isInitialized = true;
    this.logger.info('MCPServer', 'MCP server initialized successfully');
    
    // Note: initialized is a notification, no response required
    return {
      jsonrpc: "2.0",
      id: request.id,
      result: null
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

    try {
      // Create or get session context
      const sessionId = toolArgs?.sessionId || this.generateSessionId();

      // Phase 4: Check for duplicate requests
      const duplicateCheck = this.conversationContext.checkForDuplicate(
        sessionId,
        name,
        toolArgs
      );

      if (duplicateCheck.isDuplicate && duplicateCheck.previousAction) {
        this.logger.info('MCPServer', 'Duplicate request detected', {
          sessionId,
          tool: name,
          turnsSince: duplicateCheck.turnsSince
        });

        // Return helpful response instead of re-executing
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [
              {
                type: "text",
                text: `${duplicateCheck.suggestion}\n\nPrevious result:\n${JSON.stringify(duplicateCheck.previousAction.result, null, 2)}`
              }
            ],
            isError: false,
            metadata: {
              toolName: name,
              duration: Date.now() - startTime,
              sessionId,
              wasDuplicate: true,
              previousTimestamp: duplicateCheck.previousAction.timestamp
            }
          }
        };
      }
      
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

      // Phase 4: Record action for duplicate detection
      this.conversationContext.recordAction(sessionId, name, toolArgs, result);

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
      
      // Record failed request for rate limiting
      const sessionId = toolArgs?.sessionId || this.generateSessionId();
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
            sessionId: this.generateSessionId(),
            error: {
              message: (error as Error).message,
              stack: (error as Error).stack
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

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async handleHealthCheck(request: MCPRequest): Promise<MCPResponse> {
    const rateLimiterStats = this.rateLimiter.getStats();
    const conversationStats = this.conversationContext.getStats();
    const transportDisconnected = this.transport.disconnected;

    const health = {
      status: transportDisconnected ? 'degraded' : 'healthy',
      version: '0.2.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      sessions: {
        total: this.sessionManager.getAllSessions().length,
        active: this.sessionManager.getActiveSessionCount()
      },
      toolsRegistered: this.tools.size,
      database: this.memoryService.isConnected() ? 'connected' : 'disconnected',
      transport: transportDisconnected ? 'disconnected' : 'connected',
      rateLimiter: {
        activeSessions: rateLimiterStats.activeSessions,
        totalRequests: rateLimiterStats.totalRequests,
        topSessions: rateLimiterStats.topSessions
      },
      conversationContext: {
        activeSessions: conversationStats.activeSessions,
        totalActions: conversationStats.totalActions,
        averageActionsPerSession: conversationStats.averageActionsPerSession
      }
    };

    this.logger.info('MCPServer', 'Health check performed', health);

    return {
      jsonrpc: "2.0",
      id: request.id,
      result: health
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
          this.processManager.removePidFile(projectId);
          // Give it a moment to shut down
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          // Clean up stale PID file
          this.logger.info('MCPServer', 'Removing stale PID file...');
          this.processManager.removePidFile(projectId);
        }
      }

      // Initialize queue integration for background processing
      await this.queueIntegration.initialize();
      this.logger.info('MCPServer', 'Queue integration initialized');

      await this.transport.start();

      // Write PID file after successful startup
      this.processManager.writePidFile(projectId, process.pid);
      this.logger.info('MCPServer', `MCP server started successfully (PID: ${process.pid}, Project: ${projectId})`);

      // Start parent process monitoring
      this.startParentProcessMonitoring();
    } catch (error) {
      this.logger.logServiceError('MCPServer', 'start', error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      this.logger.info('MCPServer', 'Stopping MCP server...');

      // Stop parent process monitoring
      if (this.parentCheckInterval) {
        clearInterval(this.parentCheckInterval);
        this.parentCheckInterval = null;
      }

      // Clean up old sessions before shutdown
      this.sessionManager.cleanupOldSessions();

      // Shutdown session manager (persists sessions)
      this.sessionManager.shutdown();

      // Shutdown rate limiter
      this.rateLimiter.shutdown();

      // Clean up memory capture middleware
      this.memoryCaptureMiddleware.cleanupSessions();

      // Clean up conversation context
      this.conversationContext.cleanup();

      await this.transport.stop();
      this.memoryService.close();

      // Remove PID file on clean shutdown
      const projectId = this.config.getProjectId();
      this.processManager.removePidFile(projectId);

      this.logger.info('MCPServer', 'MCP server stopped');
    } catch (error) {
      this.logger.logServiceError('MCPServer', 'stop', error as Error);
      throw error;
    }
  }

  // Graceful shutdown handling
  setupSignalHandlers(): void {
    process.on('SIGINT', async () => {
      this.logger.info('MCPServer', 'Received SIGINT, shutting down gracefully...');
      await this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      this.logger.info('MCPServer', 'Received SIGTERM, shutting down gracefully...');
      await this.stop();
      process.exit(0);
    });
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

  /**
   * Start monitoring the parent process
   * If the parent dies (e.g., Claude Code crashes), exit gracefully
   */
  private startParentProcessMonitoring(): void {
    // Get parent PID - this is the process that spawned us (Claude Code)
    this.parentPid = process.ppid;

    if (!this.parentPid || this.parentPid === 1) {
      // No valid parent or parent is init - skip monitoring
      this.logger.debug('MCPServer', 'Parent process monitoring disabled (no valid parent PID)');
      return;
    }

    this.logger.debug('MCPServer', `Monitoring parent process (PID: ${this.parentPid})`);

    // Check every 30 seconds if parent is still alive
    const checkInterval = parseInt(process.env.CLAUDE_RECALL_PARENT_CHECK_INTERVAL || '30000', 10);

    this.parentCheckInterval = setInterval(() => {
      if (!this.isParentAlive()) {
        this.logger.warn('MCPServer', `Parent process (PID: ${this.parentPid}) no longer running, shutting down...`);
        this.stop().then(() => {
          process.exit(0);
        }).catch((err) => {
          this.logger.error('MCPServer', 'Error during shutdown after parent death', err);
          process.exit(1);
        });
      }
    }, checkInterval);

    // Don't prevent process exit if this is the only timer
    this.parentCheckInterval.unref();
  }

  /**
   * Check if parent process is still alive
   */
  private isParentAlive(): boolean {
    if (!this.parentPid) return true;

    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(this.parentPid, 0);
      return true;
    } catch (error: any) {
      // ESRCH means process doesn't exist
      // EPERM means it exists but we don't have permission (still alive)
      return error.code === 'EPERM';
    }
  }
}