/**
 * Autonomous Memory Agent
 *
 * A background process that:
 * 1. Subscribes to PubNub channels for tool/prompt events
 * 2. Analyzes events and searches memories proactively
 * 3. Publishes memory context back to Claude Code
 * 4. Stores outcomes intelligently
 *
 * This agent makes memory management truly autonomous.
 */

import {
  CHANNELS,
  MessageType,
  MessageFactory,
  MessageValidator,
  PubNubMessage,
  ToolExecutionMessage,
  PromptMessage,
  getDefaultConfig,
} from './config.js';
import { PubNubPublisher } from './publisher.js';

/**
 * Memory Agent - the brain of autonomous memory management
 */
export class MemoryAgent {
  private publisher: PubNubPublisher;
  private agentId: string;
  private sessionId: string;
  private projectId?: string;
  private subscribeUrl: string;
  private isRunning: boolean = false;
  private timetoken: string = '0';

  // Memory analysis state
  private recentSearches: Set<string> = new Set();
  private processingQueue: Map<string, number> = new Map();

  constructor(projectId?: string) {
    const config = getDefaultConfig();
    this.publisher = new PubNubPublisher();
    this.agentId = `memory-agent-${Date.now()}`;
    this.sessionId = config.userId;
    this.projectId = projectId;
    this.subscribeUrl = `https://ps.pndsn.com`;
  }

  /**
   * Start the agent - subscribe to channels and process events
   */
  async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[Memory Agent] Starting agent ${this.agentId}`);
    console.log(`[Memory Agent] Project: ${this.projectId || 'global'}`);
    console.log(`[Memory Agent] Subscribing to channels:`);
    console.log(`  - ${CHANNELS.TOOL_EVENTS}`);
    console.log(`  - ${CHANNELS.PROMPT_STREAM}`);

    // Announce agent started
    await this.publishHeartbeat('active');

    // Start subscription loop
    await this.subscribeLoop();
  }

  /**
   * Stop the agent gracefully
   */
  async stop(): Promise<void> {
    console.log(`[Memory Agent] Stopping agent ${this.agentId}`);
    this.isRunning = false;
    await this.publishHeartbeat('idle');
  }

  /**
   * Subscribe loop - continuously poll PubNub for messages
   */
  private async subscribeLoop(): Promise<void> {
    const config = getDefaultConfig();
    const channels = [CHANNELS.TOOL_EVENTS, CHANNELS.PROMPT_STREAM].join(',');

    while (this.isRunning) {
      try {
        // PubNub Subscribe API
        const url = `${this.subscribeUrl}/subscribe/${config.subscribeKey}/${channels}/0/${this.timetoken}`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const response = await fetch(url, {
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          console.error(`[Memory Agent] Subscribe error: ${response.status}`);
          await this.sleep(5000); // Wait 5s before retry
          continue;
        }

        const data = await response.json();

        // Update timetoken for next request
        if (data.t && data.t.t) {
          this.timetoken = data.t.t;
        }

        // Process messages
        if (data.m && Array.isArray(data.m)) {
          for (const envelope of data.m) {
            await this.handleMessage(envelope.c, envelope.d);
          }
        }

        // Heartbeat every 30 messages or 30 seconds
        if (Math.random() < 0.1) {
          await this.publishHeartbeat('active');
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          // Timeout - normal, just continue
          continue;
        }

        console.error(`[Memory Agent] Subscription error:`, error);
        await this.sleep(5000); // Wait 5s before retry
      }
    }
  }

  /**
   * Handle incoming message from PubNub
   */
  private async handleMessage(channel: string, message: any): Promise<void> {
    try {
      if (!MessageValidator.validateMessage(message)) {
        console.warn('[Memory Agent] Invalid message format:', message);
        return;
      }

      const msg = message as PubNubMessage;

      // Route message to appropriate handler
      switch (channel) {
        case CHANNELS.TOOL_EVENTS:
          if (MessageValidator.isToolExecutionMessage(msg)) {
            await this.handleToolEvent(msg);
          }
          break;

        case CHANNELS.PROMPT_STREAM:
          if (MessageValidator.isPromptMessage(msg)) {
            await this.handlePromptEvent(msg);
          }
          break;

        default:
          console.warn(`[Memory Agent] Unknown channel: ${channel}`);
      }
    } catch (error) {
      console.error('[Memory Agent] Message handling error:', error);
    }
  }

  /**
   * Handle tool execution event
   * Searches memories and publishes context
   */
  private async handleToolEvent(event: ToolExecutionMessage): Promise<void> {
    // Only process pre-execution events (that's when we need to provide context)
    if (event.type !== MessageType.TOOL_PRE_EXECUTION) {
      return;
    }

    const { toolName, toolInput, sessionId, projectId } = event;

    console.log(`[Memory Agent] Tool event: ${toolName}`);

    // Skip if already processed recently (deduplication)
    const key = `${sessionId}-${toolName}-${Date.now()}`;
    if (this.processingQueue.has(key)) {
      return;
    }
    this.processingQueue.set(key, Date.now());

    // Generate search query based on tool and input
    const query = this.generateSearchQuery(toolName, toolInput);

    if (!query) {
      return; // No meaningful query to search
    }

    console.log(`[Memory Agent] Searching: "${query}"`);

    // Search memories (would call MCP search here)
    const memories = await this.searchMemories(query, projectId);

    if (memories.length > 0) {
      console.log(`[Memory Agent] Found ${memories.length} relevant memories`);

      // Publish memory suggestions to Claude Code
      const suggestions = memories.map((m: any) => ({
        content: m.content,
        type: m.type,
        confidence: m.confidence || 0.8,
        reason: `Relevant for ${toolName} operation`,
      }));

      const suggestionMessage = MessageFactory.createMemorySuggestion(
        sessionId,
        `${toolName} on ${JSON.stringify(toolInput).substring(0, 50)}...`,
        suggestions,
        projectId
      );

      await this.publisher.publish(CHANNELS.MEMORY_CONTEXT, suggestionMessage);
      console.log(`[Memory Agent] Published ${suggestions.length} suggestions`);
    } else {
      console.log(`[Memory Agent] No relevant memories found`);
    }

    // Clean up old processing entries
    this.cleanupProcessingQueue();
  }

  /**
   * Handle user prompt event
   * Analyzes for preferences and patterns
   */
  private async handlePromptEvent(event: PromptMessage): Promise<void> {
    const { content, sessionId, projectId } = event;

    console.log(`[Memory Agent] Prompt event: "${content.substring(0, 50)}..."`);

    // Analyze prompt for preferences/patterns
    const analysis = this.analyzePrompt(content);

    if (analysis.shouldStore) {
      console.log(`[Memory Agent] Detected: ${analysis.type}`);

      // Store preference/pattern (would call MCP store here)
      await this.storeMemory(
        analysis.content,
        analysis.type,
        analysis.metadata,
        projectId
      );

      console.log(`[Memory Agent] Stored ${analysis.type}: ${analysis.content}`);
    }
  }

  /**
   * Generate search query from tool execution context
   */
  private generateSearchQuery(toolName: string, toolInput: Record<string, any>): string {
    const keywords: string[] = [];

    // Extract file path if present
    const filePath = toolInput.file_path || toolInput.path || '';
    if (filePath) {
      const filename = filePath.split('/').pop()?.split('.')[0];
      const ext = filePath.split('.').pop();

      if (filename && filename !== ext) {
        keywords.push(filename);
      }
      if (ext && ext !== filename) {
        keywords.push(ext);
      }
    }

    // Tool-specific keywords
    switch (toolName) {
      case 'Write':
        keywords.push('create', 'new', 'file');
        break;
      case 'Edit':
        keywords.push('update', 'modify', 'edit');
        break;
      case 'Bash':
        const cmd = toolInput.command || '';
        if (cmd.includes('git')) keywords.push('git');
        if (cmd.includes('npm') || cmd.includes('yarn')) keywords.push('build', 'packages');
        if (cmd.includes('test')) keywords.push('testing');
        break;
    }

    // Always include learning loop keywords
    keywords.push('preferences', 'success', 'failure', 'correction');

    return keywords.join(' ');
  }

  /**
   * Analyze prompt for preferences/patterns
   */
  private analyzePrompt(content: string): {
    shouldStore: boolean;
    type: string;
    content: string;
    metadata: Record<string, any>;
  } {
    const lower = content.toLowerCase();

    // Strong preference indicators
    const preferenceWords = ['prefer', 'always', 'never', 'from now on', 'moving forward'];
    const hasPreference = preferenceWords.some((w) => lower.includes(w));

    // Correction indicators
    const correctionWords = ['no,', 'actually', 'instead', 'correction', 'fix'];
    const isCorrection = correctionWords.some((w) => lower.includes(w));

    // Project-specific indicators
    const projectWords = ['for this project', 'in this project', 'this uses', 'we use'];
    const isProjectSpecific = projectWords.some((w) => lower.includes(w));

    if (hasPreference) {
      return {
        shouldStore: true,
        type: 'preference',
        content: content.trim(),
        metadata: { confidence: 0.9, source: 'user-prompt' },
      };
    }

    if (isCorrection) {
      return {
        shouldStore: true,
        type: 'correction',
        content: `CORRECTION: ${content.trim()}`,
        metadata: { priority: 'high', confidence: 1.0, source: 'user-prompt' },
      };
    }

    if (isProjectSpecific) {
      return {
        shouldStore: true,
        type: 'project-knowledge',
        content: content.trim(),
        metadata: { scope: 'project', confidence: 0.85, source: 'user-prompt' },
      };
    }

    return {
      shouldStore: false,
      type: 'unknown',
      content: '',
      metadata: {},
    };
  }

  /**
   * Search memories using MCP
   * TODO: Integrate with actual MCP server
   */
  private async searchMemories(
    query: string,
    projectId?: string
  ): Promise<any[]> {
    // TODO: Call MCP server's search function
    // For now, return mock data
    console.log(`[Memory Agent] TODO: Search memories for "${query}"`);
    return [];
  }

  /**
   * Store memory using MCP
   * TODO: Integrate with actual MCP server
   */
  private async storeMemory(
    content: string,
    type: string,
    metadata: Record<string, any>,
    projectId?: string
  ): Promise<void> {
    // TODO: Call MCP server's store function
    console.log(`[Memory Agent] TODO: Store ${type}: ${content}`);
  }

  /**
   * Publish agent heartbeat
   */
  private async publishHeartbeat(status: 'active' | 'idle' | 'processing'): Promise<void> {
    const message = MessageFactory.createAgentHeartbeat(
      this.sessionId,
      this.agentId,
      'memory-agent',
      status,
      '0.1.0'
    );

    await this.publisher.publish(CHANNELS.PRESENCE, message);
  }

  /**
   * Cleanup old processing queue entries
   */
  private cleanupProcessingQueue(): void {
    const now = Date.now();
    const maxAge = 60000; // 1 minute

    for (const [key, timestamp] of this.processingQueue.entries()) {
      if (now - timestamp > maxAge) {
        this.processingQueue.delete(key);
      }
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Main entry point for running agent
 */
export async function runAgent(projectId?: string): Promise<void> {
  const agent = new MemoryAgent(projectId);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[Memory Agent] Shutting down...');
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await agent.stop();
    process.exit(0);
  });

  // Start the agent
  await agent.start();
}

// If run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectId = process.argv[2];
  runAgent(projectId).catch((error) => {
    console.error('[Memory Agent] Fatal error:', error);
    process.exit(1);
  });
}
