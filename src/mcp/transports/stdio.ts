import { createInterface, Interface } from 'node:readline';
import { stdin, stdout } from 'node:process';

export interface MCPRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: any;
}

export interface MCPResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface MCPNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

export type RequestHandler = (request: MCPRequest) => Promise<MCPResponse>;
export type NotificationHandler = (notification: MCPNotification) => Promise<void>;
export type CloseHandler = () => void;

export class StdioTransport {
  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private closeHandler?: CloseHandler;
  private readline?: Interface;
  private running = false;
  private isShuttingDown = false;

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Transport already running');
    }

    // Create readline interface for stdin
    this.readline = createInterface({
      input: stdin,
      output: stdout,
      terminal: false,
    });

    // Set up line handler
    this.readline.on('line', (line: string) => {
      try {
        this.processLine(line);
      } catch (error) {
        console.error('Error processing line:', error);
      }
    });

    // stdin closing means the client (Claude Code) has disconnected.
    // A stdio transport cannot "reconnect" to an ended stream — notify the
    // owner so it can shut down cleanly instead of lingering as a zombie.
    this.readline.on('close', () => {
      const wasRunning = this.running;
      this.running = false;
      if (wasRunning && !this.isShuttingDown && this.closeHandler) {
        this.closeHandler();
      }
    });

    this.readline.on('error', (error: Error) => {
      // stderr only — stdout is the JSON-RPC channel
      console.error('Readline error:', error);
    });

    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.isShuttingDown = true;
    this.running = false;

    if (this.readline) {
      this.readline.close();
      this.readline = undefined;
    }

    this.isShuttingDown = false;
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  /**
   * Register a handler invoked when the client disconnects (stdin EOF).
   * Not called during an explicit stop().
   */
  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  private processLine(line: string): void {
    // MCP stdio framing is newline-delimited JSON
    if (line.trim() === '') {
      return;
    }

    this.processMessage(line).catch(error => {
      console.error('Error processing message:', error);
    });
  }

  private async processMessage(messageStr: string): Promise<void> {
    let message: any;

    try {
      message = JSON.parse(messageStr.trim());
      this.validateMessage(message);
    } catch (error) {
      // JSON-RPC 2.0: id must be null when it cannot be determined
      let id: string | number | null = null;
      try {
        const parsed = JSON.parse(messageStr);
        if (parsed.id !== undefined) {
          id = parsed.id;
        }
      } catch {
        // Ignore parse error for ID extraction
      }

      await this.sendResponse({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32700,
          message: 'Parse error',
        },
      });
      return;
    }

    // Check if this is a notification (no id field) or a request
    if (message.id === undefined) {
      // This is a notification
      await this.handleNotification(message as MCPNotification);
    } else {
      // This is a request
      await this.handleRequest(message as MCPRequest);
    }
  }

  private async handleRequest(request: MCPRequest): Promise<void> {
    if (!this.requestHandler) {
      await this.sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'No request handler registered',
        },
      });
      return;
    }

    try {
      const response = await this.requestHandler(request);
      await this.sendResponse(response);
    } catch (error) {
      await this.sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async handleNotification(notification: MCPNotification): Promise<void> {
    if (!this.notificationHandler) {
      // Notifications don't send error responses
      return;
    }

    try {
      await this.notificationHandler(notification);
    } catch (error) {
      // Notifications don't send error responses
      console.error('Notification handler error:', error);
    }
  }

  private async sendResponse(response: MCPResponse): Promise<void> {
    try {
      const json = JSON.stringify(response);
      stdout.write(json + '\n');
    } catch (error) {
      console.error('Failed to send response:', error);
    }
  }

  async sendNotification(notification: MCPNotification): Promise<void> {
    const json = JSON.stringify(notification);
    stdout.write(json + '\n');
  }

  // Message validation
  private validateMessage(message: any): void {
    if (!message.jsonrpc || message.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC version');
    }

    if (!message.method || typeof message.method !== 'string') {
      throw new Error(message.id !== undefined
        ? 'Invalid request: missing method'
        : 'Invalid notification: missing method');
    }
  }
}
