/**
 * PubNub Integration Configuration
 *
 * Defines the real-time event architecture for autonomous memory management.
 *
 * Architecture:
 * - Claude Code Hooks → Publish events → PubNub
 * - Memory Agent → Subscribe to events → Process → Store locally
 * - Memory Agent → Publish context → Claude Code receives suggestions
 *
 * Privacy: PubNub is used for event coordination only, NOT storage.
 * All memory persistence remains local in SQLite.
 */

export interface PubNubConfig {
  publishKey: string;
  subscribeKey: string;
  userId: string;
  // Use demo keys by default - can be overridden via environment
  ssl: boolean;
  heartbeatInterval?: number;
  presenceTimeout?: number;
}

/**
 * Channel Architecture for Memory Events
 */
export const CHANNELS = {
  // Claude Code publishes tool execution events (Write, Edit, Bash, etc.)
  TOOL_EVENTS: 'claude-tool-events',

  // Claude Code publishes user prompts for preference extraction
  PROMPT_STREAM: 'claude-prompt-stream',

  // Memory Agent publishes memory context/suggestions back to Claude Code
  MEMORY_CONTEXT: 'claude-memory-context',

  // Memory Agent publishes storage confirmation events (for debugging)
  MEMORY_STORAGE: 'claude-memory-storage',

  // Presence channel for knowing which agents/sessions are active
  PRESENCE: 'claude-presence',
} as const;

/**
 * Message Types for Event Classification
 */
export enum MessageType {
  // Tool execution events
  TOOL_PRE_EXECUTION = 'tool.pre_execution',
  TOOL_POST_EXECUTION = 'tool.post_execution',
  TOOL_ERROR = 'tool.error',

  // Prompt events
  PROMPT_SUBMITTED = 'prompt.submitted',
  PROMPT_RESPONSE = 'prompt.response',

  // Memory events
  MEMORY_SEARCH_REQUEST = 'memory.search_request',
  MEMORY_SEARCH_RESULT = 'memory.search_result',
  MEMORY_STORE_REQUEST = 'memory.store_request',
  MEMORY_STORED = 'memory.stored',
  MEMORY_SUGGESTION = 'memory.suggestion',

  // Agent lifecycle
  AGENT_STARTED = 'agent.started',
  AGENT_STOPPED = 'agent.stopped',
  AGENT_HEARTBEAT = 'agent.heartbeat',
}

/**
 * Base message structure for all PubNub events
 */
export interface BaseMessage {
  type: MessageType;
  timestamp: number;
  sessionId: string;
  projectId?: string;
}

/**
 * Tool execution event published by hooks
 */
export interface ToolExecutionMessage extends BaseMessage {
  type: MessageType.TOOL_PRE_EXECUTION | MessageType.TOOL_POST_EXECUTION;
  toolName: string;
  toolInput: Record<string, any>;
  toolOutput?: any;
  duration?: number;
}

/**
 * Tool error event
 */
export interface ToolErrorMessage extends BaseMessage {
  type: MessageType.TOOL_ERROR;
  toolName: string;
  toolInput: Record<string, any>;
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
}

/**
 * User prompt event
 */
export interface PromptMessage extends BaseMessage {
  type: MessageType.PROMPT_SUBMITTED | MessageType.PROMPT_RESPONSE;
  content: string;
  role: 'user' | 'assistant';
}

/**
 * Memory search request from hooks
 */
export interface MemorySearchRequest extends BaseMessage {
  type: MessageType.MEMORY_SEARCH_REQUEST;
  query: string;
  filters?: {
    types?: string[];
    scope?: string;
    limit?: number;
  };
}

/**
 * Memory search result from agent
 */
export interface MemorySearchResult extends BaseMessage {
  type: MessageType.MEMORY_SEARCH_RESULT;
  requestId: string;
  memories: Array<{
    id: number;
    content: string;
    type: string;
    confidence: number;
    relevance?: number;
  }>;
  count: number;
}

/**
 * Memory storage request
 */
export interface MemoryStoreRequest extends BaseMessage {
  type: MessageType.MEMORY_STORE_REQUEST;
  content: string;
  metadata: {
    type: string;
    priority?: string;
    scope?: string;
    [key: string]: any;
  };
}

/**
 * Memory storage confirmation
 */
export interface MemoryStoredMessage extends BaseMessage {
  type: MessageType.MEMORY_STORED;
  memoryId: number;
  content: string;
  memoryType: string;
}

/**
 * Proactive memory suggestion from agent
 */
export interface MemorySuggestion extends BaseMessage {
  type: MessageType.MEMORY_SUGGESTION;
  context: string; // What triggered the suggestion
  suggestions: Array<{
    content: string;
    type: string;
    confidence: number;
    reason: string; // Why this is relevant
  }>;
}

/**
 * Agent lifecycle events
 */
export interface AgentLifecycleMessage extends BaseMessage {
  type: MessageType.AGENT_STARTED | MessageType.AGENT_STOPPED | MessageType.AGENT_HEARTBEAT;
  agentId: string;
  agentType: 'memory-agent' | 'claude-code';
  version?: string;
  status?: 'active' | 'idle' | 'processing';
}

/**
 * Union type of all message types
 */
export type PubNubMessage =
  | ToolExecutionMessage
  | ToolErrorMessage
  | PromptMessage
  | MemorySearchRequest
  | MemorySearchResult
  | MemoryStoreRequest
  | MemoryStoredMessage
  | MemorySuggestion
  | AgentLifecycleMessage;

/**
 * Default PubNub configuration
 */
export function getDefaultConfig(): PubNubConfig {
  return {
    // Demo keys - replace with environment variables for production
    publishKey: process.env.PUBNUB_PUBLISH_KEY || 'demo',
    subscribeKey: process.env.PUBNUB_SUBSCRIBE_KEY || 'demo',
    userId: process.env.PUBNUB_USER_ID || `claude-recall-${Date.now()}`,
    ssl: true,
    heartbeatInterval: 30,
    presenceTimeout: 60,
  };
}

/**
 * Message factory helpers
 */
export class MessageFactory {
  static createToolPreExecution(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, any>,
    projectId?: string
  ): ToolExecutionMessage {
    return {
      type: MessageType.TOOL_PRE_EXECUTION,
      timestamp: Date.now(),
      sessionId,
      projectId,
      toolName,
      toolInput,
    };
  }

  static createToolPostExecution(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, any>,
    toolOutput: any,
    duration: number,
    projectId?: string
  ): ToolExecutionMessage {
    return {
      type: MessageType.TOOL_POST_EXECUTION,
      timestamp: Date.now(),
      sessionId,
      projectId,
      toolName,
      toolInput,
      toolOutput,
      duration,
    };
  }

  static createToolError(
    sessionId: string,
    toolName: string,
    toolInput: Record<string, any>,
    error: Error,
    projectId?: string
  ): ToolErrorMessage {
    return {
      type: MessageType.TOOL_ERROR,
      timestamp: Date.now(),
      sessionId,
      projectId,
      toolName,
      toolInput,
      error: {
        message: error.message,
        code: (error as any).code,
        stack: error.stack,
      },
    };
  }

  static createPromptSubmitted(
    sessionId: string,
    content: string,
    projectId?: string
  ): PromptMessage {
    return {
      type: MessageType.PROMPT_SUBMITTED,
      timestamp: Date.now(),
      sessionId,
      projectId,
      content,
      role: 'user',
    };
  }

  static createMemorySearchRequest(
    sessionId: string,
    query: string,
    filters?: MemorySearchRequest['filters'],
    projectId?: string
  ): MemorySearchRequest {
    return {
      type: MessageType.MEMORY_SEARCH_REQUEST,
      timestamp: Date.now(),
      sessionId,
      projectId,
      query,
      filters,
    };
  }

  static createMemorySuggestion(
    sessionId: string,
    context: string,
    suggestions: MemorySuggestion['suggestions'],
    projectId?: string
  ): MemorySuggestion {
    return {
      type: MessageType.MEMORY_SUGGESTION,
      timestamp: Date.now(),
      sessionId,
      projectId,
      context,
      suggestions,
    };
  }

  static createAgentHeartbeat(
    sessionId: string,
    agentId: string,
    agentType: 'memory-agent' | 'claude-code',
    status: 'active' | 'idle' | 'processing',
    version?: string
  ): AgentLifecycleMessage {
    return {
      type: MessageType.AGENT_HEARTBEAT,
      timestamp: Date.now(),
      sessionId,
      agentId,
      agentType,
      status,
      version,
    };
  }
}

/**
 * Message validation helpers
 */
export class MessageValidator {
  static isToolExecutionMessage(msg: any): msg is ToolExecutionMessage {
    return (
      msg.type === MessageType.TOOL_PRE_EXECUTION ||
      msg.type === MessageType.TOOL_POST_EXECUTION
    );
  }

  static isPromptMessage(msg: any): msg is PromptMessage {
    return (
      msg.type === MessageType.PROMPT_SUBMITTED ||
      msg.type === MessageType.PROMPT_RESPONSE
    );
  }

  static isMemorySearchRequest(msg: any): msg is MemorySearchRequest {
    return msg.type === MessageType.MEMORY_SEARCH_REQUEST;
  }

  static isMemoryStoreRequest(msg: any): msg is MemoryStoreRequest {
    return msg.type === MessageType.MEMORY_STORE_REQUEST;
  }

  static validateMessage(msg: any): msg is PubNubMessage {
    return (
      msg &&
      typeof msg === 'object' &&
      typeof msg.type === 'string' &&
      typeof msg.timestamp === 'number' &&
      typeof msg.sessionId === 'string'
    );
  }
}
