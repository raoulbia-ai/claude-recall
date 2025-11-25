/**
 * PubNub Event Publisher
 *
 * Lightweight utility for publishing events from hooks to PubNub.
 * Used by both Python hooks (via CLI) and Node.js code.
 */

import PubNub from 'pubnub';
import { CHANNELS, MessageFactory, PubNubMessage, getDefaultConfig } from './config.js';

export class PubNubPublisher {
  private pubnub: PubNub;

  constructor() {
    const config = getDefaultConfig();
    this.pubnub = new PubNub({
      publishKey: config.publishKey,
      subscribeKey: config.subscribeKey,
      userId: config.userId
    });
  }

  /**
   * Publish a message to a channel
   * Non-blocking, fire-and-forget for hook performance
   */
  async publish(channel: string, message: PubNubMessage): Promise<boolean> {
    try {
      // Use PubNub SDK for reliable message delivery
      // Cast to any to satisfy PubNub's Payload type requirements
      const result = await this.pubnub.publish({
        channel,
        message: message as any
      });

      return !!result; // Success if publish completed
    } catch (error) {
      // Silently fail - hooks should never block on PubNub errors
      console.error('[PubNub] Publish failed:', error);
      return false;
    }
  }

  /**
   * Publish tool pre-execution event
   */
  async publishToolPreExecution(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, any>,
    projectId?: string
  ): Promise<boolean> {
    const message = MessageFactory.createToolPreExecution(
      sessionId,
      toolName,
      toolInput,
      projectId
    );
    return this.publish(CHANNELS.TOOL_EVENTS, message);
  }

  /**
   * Publish tool post-execution event
   */
  async publishToolPostExecution(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, any>,
    toolOutput: any,
    duration: number,
    projectId?: string
  ): Promise<boolean> {
    const message = MessageFactory.createToolPostExecution(
      sessionId,
      toolName,
      toolInput,
      toolOutput,
      duration,
      projectId
    );
    return this.publish(CHANNELS.TOOL_EVENTS, message);
  }

  /**
   * Publish tool error event
   */
  async publishToolError(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, any>,
    error: Error,
    projectId?: string
  ): Promise<boolean> {
    const message = MessageFactory.createToolError(
      sessionId,
      toolName,
      toolInput,
      error,
      projectId
    );
    return this.publish(CHANNELS.TOOL_EVENTS, message);
  }

  /**
   * Publish user prompt event
   */
  async publishPromptSubmitted(
    sessionId: string,
    content: string,
    projectId?: string
  ): Promise<boolean> {
    const message = MessageFactory.createPromptSubmitted(sessionId, content, projectId);
    return this.publish(CHANNELS.PROMPT_STREAM, message);
  }

  /**
   * Publish memory search request
   */
  async publishMemorySearchRequest(
    sessionId: string,
    query: string,
    filters?: any,
    projectId?: string
  ): Promise<boolean> {
    const message = MessageFactory.createMemorySearchRequest(
      sessionId,
      query,
      filters,
      projectId
    );
    return this.publish(CHANNELS.TOOL_EVENTS, message);
  }
}

/**
 * CLI interface for hooks
 * Usage: node publisher-cli.js <event-type> <json-data>
 */
export async function publishFromCLI(args: string[]): Promise<void> {
  if (args.length < 2) {
    console.error('Usage: publisher-cli <event-type> <json-data>');
    process.exit(1);
  }

  const [eventType, jsonData] = args;
  const publisher = new PubNubPublisher();

  try {
    const data = JSON.parse(jsonData);

    switch (eventType) {
      case 'tool-pre':
        await publisher.publishToolPreExecution(
          data.sessionId,
          data.toolName,
          data.toolInput,
          data.projectId
        );
        break;

      case 'tool-post':
        await publisher.publishToolPostExecution(
          data.sessionId,
          data.toolName,
          data.toolInput,
          data.toolOutput,
          data.duration,
          data.projectId
        );
        break;

      case 'tool-error':
        await publisher.publishToolError(
          data.sessionId,
          data.toolName,
          data.toolInput,
          new Error(data.error.message),
          data.projectId
        );
        break;

      case 'prompt':
        await publisher.publishPromptSubmitted(
          data.sessionId,
          data.content,
          data.projectId
        );
        break;

      default:
        console.error(`Unknown event type: ${eventType}`);
        process.exit(1);
    }

    console.log(`[PubNub] Published ${eventType} event`);
  } catch (error) {
    console.error('[PubNub] Publish error:', error);
    process.exit(1);
  }
}

// If run directly as CLI (CommonJS pattern)
if (require.main === module) {
  publishFromCLI(process.argv.slice(2));
}
