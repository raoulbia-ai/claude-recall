import { QueueAPI, QueueProcessorFactory } from './queue-api';
import { LoggingService } from './logging';
import { MemoryService } from './memory';
import { ConfigService } from './config';

/**
 * Integration layer that connects the queue system with existing Claude Recall components
 * This service manages the lifecycle and coordination of queue-based processing
 */
export class QueueIntegrationService {
  private static instance: QueueIntegrationService;
  private queueAPI: QueueAPI;
  private logger = LoggingService.getInstance();
  private config = ConfigService.getInstance();
  private isInitialized = false;
  private processors: Map<string, any> = new Map();

  private constructor() {
    this.queueAPI = QueueAPI.getInstance();
  }

  static getInstance(): QueueIntegrationService {
    if (!QueueIntegrationService.instance) {
      QueueIntegrationService.instance = new QueueIntegrationService();
    }
    return QueueIntegrationService.instance;
  }

  /**
   * Initialize the queue integration system
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      this.logger.info('QueueIntegrationService', 'Initializing queue integration system');

      // Register all queue processors
      await this.registerProcessors();

      // Set up event listeners for existing services
      await this.setupEventListeners();

      // Initialize queue health monitoring
      this.startHealthMonitoring();

      this.isInitialized = true;
      this.logger.info('QueueIntegrationService', 'Queue integration system initialized successfully');
    } catch (error) {
      this.logger.error('QueueIntegrationService', 'Failed to initialize', error);
      throw error;
    }
  }

  /**
   * Register all queue processors
   */
  private async registerProcessors(): Promise<void> {
    // Hook event processor for processing hook events asynchronously
    const hookProcessor = QueueProcessorFactory.createHookEventProcessor();
    this.queueAPI.registerProcessor('hook-events', hookProcessor);
    this.processors.set('hook-events', hookProcessor);

    // MCP operation processor for handling MCP tool operations
    const mcpProcessor = QueueProcessorFactory.createMCPProcessor();
    this.queueAPI.registerProcessor('mcp-operations', mcpProcessor);
    this.processors.set('mcp-operations', mcpProcessor);

    // Memory operation processor for handling memory operations
    const memoryProcessor = QueueProcessorFactory.createMemoryProcessor();
    this.queueAPI.registerProcessor('memory-operations', memoryProcessor);
    this.processors.set('memory-operations', memoryProcessor);

    // Pattern detection processor for analyzing content patterns
    const patternProcessor = QueueProcessorFactory.createPatternProcessor();
    this.queueAPI.registerProcessor('pattern-detection', patternProcessor);
    this.processors.set('pattern-detection', patternProcessor);

    this.logger.info('QueueIntegrationService', 'All processors registered successfully');
  }

  /**
   * Set up event listeners to intercept and queue operations
   */
  private async setupEventListeners(): Promise<void> {
    // Monkey patch memory service to use queue for non-critical operations
    await this.patchMemoryService();

    // Set up process event listeners
    this.setupProcessEventListeners();

    this.logger.info('QueueIntegrationService', 'Event listeners configured');
  }

  /**
   * Patch MemoryService to use queue for background operations
   */
  private async patchMemoryService(): Promise<void> {
    const memoryService = MemoryService.getInstance();
    const originalStore = memoryService.store.bind(memoryService);
    const originalStorePreference = memoryService.storePreferenceWithOverride.bind(memoryService);

    // Override store method to use queue for pattern detection
    memoryService.store = (request: any) => {
      // Store immediately for critical operations
      const result = originalStore(request);

      // Queue pattern detection if it's user content
      if (request.type === 'user-content' || request.type === 'preference') {
        this.queueAPI.enqueuePatternDetection(
          JSON.stringify(request.value),
          {
            type: request.type,
            projectId: request.context?.projectId,
            filePath: request.context?.filePath
          },
          {
            priority: request.type === 'preference' ? 5 : 1,
            correlationId: `memory-${request.key}`
          }
        );
      }

      return result;
    };

    // Override preference storage to use queue for analysis
    memoryService.storePreferenceWithOverride = (preference: any, context: any) => {
      // Store preference immediately
      const result = originalStorePreference(preference, context);

      // Queue for enhanced pattern analysis
      this.queueAPI.enqueuePatternDetection(
        preference.value,
        {
          ...context,
          preferenceKey: preference.key,
          isOverride: preference.isOverride
        },
        {
          priority: 8, // High priority for preferences
          correlationId: `preference-${preference.key}`,
          maxRetries: 2
        }
      );

      return result;
    };

    this.logger.info('QueueIntegrationService', 'MemoryService patched for queue integration');
  }

  /**
   * Set up process event listeners for graceful shutdown
   */
  private setupProcessEventListeners(): void {
    const gracefulShutdown = () => {
      this.logger.info('QueueIntegrationService', 'Graceful shutdown initiated');
      this.shutdown();
      process.exit(0);
    };

    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    process.on('uncaughtException', (error) => {
      this.logger.error('QueueIntegrationService', 'Uncaught exception', error);
      this.shutdown();
      process.exit(1);
    });
  }

  /**
   * Start health monitoring for queues
   */
  private startHealthMonitoring(): void {
    // Monitor queue health every 30 seconds
    setInterval(() => {
      this.checkQueueHealth();
    }, 30000);

    this.logger.info('QueueIntegrationService', 'Health monitoring started');
  }

  /**
   * Check queue health and log warnings for issues
   */
  private async checkQueueHealth(): Promise<void> {
    try {
      const health = this.queueAPI.getSystemHealth();

      // Log warnings for unhealthy conditions
      if (!health.isHealthy) {
        this.logger.warn('QueueIntegrationService', 'Queue system unhealthy', {
          pendingMessages: health.totalPendingMessages,
          processingMessages: health.totalProcessingMessages,
          failedMessages: health.totalFailedMessages,
          deadLetterCount: health.deadLetterCount
        });
      }

      // Alert on high dead letter queue count
      if (health.deadLetterCount > 100) {
        this.logger.error('QueueIntegrationService', 'High dead letter queue count detected', {
          deadLetterCount: health.deadLetterCount
        });
      }

      // Alert on stuck processing messages
      if (health.totalProcessingMessages > 50) {
        this.logger.warn('QueueIntegrationService', 'Many messages stuck in processing', {
          processingMessages: health.totalProcessingMessages
        });
      }
    } catch (error) {
      this.logger.error('QueueIntegrationService', 'Health check failed', error);
    }
  }

  /**
   * Hook integration methods for external services
   */

  /**
   * Process hook event asynchronously
   */
  processHookEvent(
    eventType: string,
    payload: any,
    options: {
      priority?: number;
      delayMs?: number;
      correlationId?: string;
    } = {}
  ): number {
    return this.queueAPI.enqueueHookEvent(eventType, payload, options);
  }

  /**
   * Process MCP operation asynchronously
   */
  processMCPOperation(
    toolName: string,
    operation: string,
    payload: any,
    options: {
      priority?: number;
      delayMs?: number;
      correlationId?: string;
    } = {}
  ): number {
    return this.queueAPI.enqueueMCPOperation(toolName, operation, payload, options);
  }

  /**
   * Process memory operation asynchronously
   */
  processMemoryOperation(
    operation: 'store' | 'search' | 'update' | 'delete',
    payload: any,
    options: {
      priority?: number;
      delayMs?: number;
      correlationId?: string;
    } = {}
  ): number {
    return this.queueAPI.enqueueMemoryOperation(operation, payload, options);
  }

  /**
   * Get queue statistics for monitoring
   */
  getQueueStats(queueName?: string): any {
    return this.queueAPI.getQueueStats(queueName);
  }

  /**
   * Get dead letter messages for debugging
   */
  getDeadLetterMessages(limit?: number): any[] {
    return this.queueAPI.getDeadLetterMessages(limit);
  }

  /**
   * Requeue messages from dead letter queue
   */
  requeueFromDeadLetter(messageIds: number[]): number {
    return this.queueAPI.requeueFromDeadLetter(messageIds);
  }

  /**
   * Get system health status
   */
  getSystemHealth(): any {
    return this.queueAPI.getSystemHealth();
  }

  /**
   * Shutdown the integration service
   */
  shutdown(): void {
    if (!this.isInitialized) {
      return;
    }

    this.logger.info('QueueIntegrationService', 'Shutting down queue integration service');

    // Stop all processors
    for (const [queueName, processor] of this.processors) {
      if (processor && typeof processor.stop === 'function') {
        processor.stop();
        this.logger.info('QueueIntegrationService', `Processor stopped: ${queueName}`);
      }
    }

    // Close queue API
    this.queueAPI.close();

    this.isInitialized = false;
    this.logger.info('QueueIntegrationService', 'Queue integration service shut down');
  }
}

/**
 * Hook integration helper for backward compatibility
 * This maintains the existing hook interface while adding queue processing
 */
export class HookQueueIntegration {
  private static instance: HookQueueIntegration;
  private integrationService: QueueIntegrationService;
  private logger = LoggingService.getInstance();

  private constructor() {
    this.integrationService = QueueIntegrationService.getInstance();
  }

  static getInstance(): HookQueueIntegration {
    if (!HookQueueIntegration.instance) {
      HookQueueIntegration.instance = new HookQueueIntegration();
    }
    return HookQueueIntegration.instance;
  }

  /**
   * Process a tool use event through the queue system
   */
  processToolUse(toolName: string, toolInput: any, context: any): void {
    this.integrationService.processHookEvent(
      'tool-use',
      {
        toolName,
        toolInput,
        context
      },
      {
        priority: 5, // Medium-high priority for tool use tracking
        correlationId: `tool-${toolName}-${Date.now()}`
      }
    );

    this.logger.debug('HookQueueIntegration', 'Tool use queued for processing', {
      toolName,
      contextKeys: Object.keys(context || {})
    });
  }

  /**
   * Process a user prompt through the queue system
   */
  processUserPrompt(content: string, context: any): void {
    this.integrationService.processHookEvent(
      'user-prompt',
      {
        content,
        context
      },
      {
        priority: 3, // Medium priority
        correlationId: `prompt-${Date.now()}`
      }
    );

    this.logger.debug('HookQueueIntegration', 'User prompt queued for processing', {
      contentLength: content.length,
      contextKeys: Object.keys(context || {})
    });
  }

  /**
   * Process a Claude response through the queue system
   */
  processClaudeResponse(content: string, context: any): void {
    this.integrationService.processHookEvent(
      'claude-response',
      {
        content,
        context
      },
      {
        priority: 2, // Lower priority than user prompts
        correlationId: `response-${Date.now()}`
      }
    );

    this.logger.debug('HookQueueIntegration', 'Claude response queued for processing', {
      contentLength: content.length,
      contextKeys: Object.keys(context || {})
    });
  }

  /**
   * Initialize the hook integration system
   */
  async initialize(): Promise<void> {
    await this.integrationService.initialize();
    this.logger.info('HookQueueIntegration', 'Hook queue integration initialized');
  }
}

/**
 * MCP integration helper for queue-based MCP operations
 */
export class MCPQueueIntegration {
  private static instance: MCPQueueIntegration;
  private integrationService: QueueIntegrationService;
  private logger = LoggingService.getInstance();

  private constructor() {
    this.integrationService = QueueIntegrationService.getInstance();
  }

  static getInstance(): MCPQueueIntegration {
    if (!MCPQueueIntegration.instance) {
      MCPQueueIntegration.instance = new MCPQueueIntegration();
    }
    return MCPQueueIntegration.instance;
  }

  /**
   * Process an MCP tool call asynchronously
   */
  processToolCall(
    toolName: string,
    operation: string,
    payload: any,
    options: {
      priority?: number;
      requiresResponse?: boolean;
      timeout?: number;
    } = {}
  ): number {
    const messageId = this.integrationService.processMCPOperation(
      toolName,
      operation,
      payload,
      {
        priority: options.priority || (options.requiresResponse ? 7 : 4),
        correlationId: `mcp-${toolName}-${operation}-${Date.now()}`
      }
    );

    this.logger.debug('MCPQueueIntegration', 'MCP operation queued', {
      messageId,
      toolName,
      operation,
      requiresResponse: options.requiresResponse
    });

    return messageId;
  }

  /**
   * Process a memory search operation
   */
  processMemorySearch(query: string, context: any): number {
    return this.processToolCall(
      'memory',
      'search',
      { query, context },
      {
        priority: 6, // High priority for memory searches
        requiresResponse: true
      }
    );
  }

  /**
   * Process a memory store operation
   */
  processMemoryStore(data: any, context: any): number {
    return this.processToolCall(
      'memory',
      'store',
      { data, context },
      {
        priority: 5, // Medium-high priority for memory storage
        requiresResponse: false
      }
    );
  }

  /**
   * Initialize the MCP integration system
   */
  async initialize(): Promise<void> {
    await this.integrationService.initialize();
    this.logger.info('MCPQueueIntegration', 'MCP queue integration initialized');
  }
}