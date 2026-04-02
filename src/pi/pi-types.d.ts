/**
 * Ambient type declarations for Pi's Extension API.
 * Based on @mariozechner/pi-coding-agent v0.64.0.
 *
 * These types are provided at runtime by Pi — never import from the Pi package.
 * Only declares what claude-recall actually uses.
 */

declare namespace PiTypes {

  interface TextContent {
    type: 'text';
    text: string;
  }

  interface ImageContent {
    type: 'image';
    source: any;
  }

  interface AgentToolResult<TDetails = unknown> {
    content: (TextContent | ImageContent)[];
    isError?: boolean;
    details?: TDetails;
  }

  type AgentToolUpdateCallback<TDetails = unknown> = (update: Partial<AgentToolResult<TDetails>>) => void;

  interface ToolDefinition<TParams = any, TDetails = unknown, TState = any> {
    name: string;
    label: string;
    description: string;
    promptSnippet?: string;
    promptGuidelines?: string[];
    parameters: TParams;
    execute(
      toolCallId: string,
      params: any,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<TDetails>>;
  }

  interface ExtensionContext {
    ui: any;
    hasUI: boolean;
    cwd: string;
    sessionManager: any;
    modelRegistry: any;
    model: any;
    isIdle(): boolean;
    signal: AbortSignal | undefined;
    abort(): void;
    shutdown(): void;
    getSystemPrompt(): string;
  }

  // --- Events ---

  interface SessionStartEvent { type: 'session_start'; }
  interface SessionShutdownEvent { type: 'session_shutdown'; }

  interface BeforeAgentStartEvent {
    type: 'before_agent_start';
    prompt: string;
    systemPrompt: string;
  }

  interface BeforeAgentStartEventResult {
    systemPrompt?: string;
  }

  interface TurnEndEvent {
    type: 'turn_end';
    turnIndex: number;
    message: any;
    toolResults: any[];
  }

  interface InputEvent {
    type: 'input';
    text: string;
    source: 'interactive' | 'rpc' | 'extension';
  }

  type InputEventResult =
    | { action: 'continue' }
    | { action: 'transform'; text: string }
    | { action: 'handled' };

  interface ToolResultEvent {
    type: 'tool_result';
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
    content: (TextContent | ImageContent)[];
    isError: boolean;
    details: unknown;
  }

  interface SessionBeforeCompactEvent {
    type: 'session_before_compact';
    branchEntries: any[];
    customInstructions?: string;
  }

  // --- Handler types ---

  type ExtensionHandler<E, R = undefined> = (
    event: E,
    ctx: ExtensionContext,
  ) => Promise<R | void> | R | void;

  // --- Extension API ---

  interface ExtensionAPI {
    on(event: 'session_start', handler: ExtensionHandler<SessionStartEvent>): void;
    on(event: 'session_shutdown', handler: ExtensionHandler<SessionShutdownEvent>): void;
    on(event: 'before_agent_start', handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>): void;
    on(event: 'turn_end', handler: ExtensionHandler<TurnEndEvent>): void;
    on(event: 'input', handler: ExtensionHandler<InputEvent, InputEventResult>): void;
    on(event: 'tool_result', handler: ExtensionHandler<ToolResultEvent>): void;
    on(event: 'session_before_compact', handler: ExtensionHandler<SessionBeforeCompactEvent>): void;

    registerTool(tool: ToolDefinition): void;
    registerCommand(name: string, options: {
      description?: string;
      handler: (args: string, ctx: any) => Promise<void>;
    }): void;
    sendMessage(message: any, options?: any): void;
  }
}
