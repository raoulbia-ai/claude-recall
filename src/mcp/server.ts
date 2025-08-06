import { StdioTransport } from './transports/stdio';
import { MemoryTools } from './tools/memory-tools';
import { MemoryService } from '../services/memory';
import { LoggingService } from '../services/logging';
import { SessionManager } from './session-manager';
import { RateLimiter } from './rate-limiter';
import { MemoryCaptureMiddleware } from './memory-capture-middleware';

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
  private isInitialized = false;

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
    const tools = memoryTools.getTools();
    
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
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
    
    const health = {
      status: 'healthy',
      version: '0.2.0',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      sessions: {
        total: this.sessionManager.getAllSessions().length,
        active: this.sessionManager.getActiveSessionCount()
      },
      toolsRegistered: this.tools.size,
      database: this.memoryService.isConnected() ? 'connected' : 'disconnected',
      rateLimiter: {
        activeSessions: rateLimiterStats.activeSessions,
        totalRequests: rateLimiterStats.totalRequests,
        topSessions: rateLimiterStats.topSessions
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
      await this.transport.start();
      this.logger.info('MCPServer', 'MCP server started successfully');
    } catch (error) {
      this.logger.logServiceError('MCPServer', 'start', error as Error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      this.logger.info('MCPServer', 'Stopping MCP server...');
      
      // Clean up old sessions before shutdown
      this.sessionManager.cleanupOldSessions();
      
      // Shutdown session manager (persists sessions)
      this.sessionManager.shutdown();
      
      // Shutdown rate limiter
      this.rateLimiter.shutdown();
      
      // Clean up memory capture middleware
      this.memoryCaptureMiddleware.cleanupSessions();
      
      await this.transport.stop();
      this.memoryService.close();
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
}