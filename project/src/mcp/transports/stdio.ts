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
  id: string | number;
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

export class StdioTransport {
  private requestHandler?: RequestHandler;
  private notificationHandler?: NotificationHandler;
  private readline?: Interface;
  private running = false;
  private messageBuffer = '';
  private expectedLength = 0;
  
  // Claude-flow pattern: Reconnection handling
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private reconnectDelay = 1000;
  private isShuttingDown = false;

  constructor() {}

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Transport already running');
    }

    try {
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

      this.readline.on('close', () => {
        const wasRunning = this.running;
        this.running = false;
        // Claude-flow pattern: Attempt reconnection on unexpected close
        // Only attempt reconnection if we were running and not shutting down
        if (wasRunning && !this.isShuttingDown && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.handleTransportError(new Error('Transport closed unexpectedly'));
        }
      });

      this.readline.on('error', (error: Error) => {
        console.error('Readline error:', error);
        this.handleTransportError(error);
      });

      this.running = true;
      this.reconnectAttempts = 0; // Reset on successful start
    } catch (error) {
      await this.handleTransportError(error as Error);
    }
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

  private processLine(line: string): void {
    // Handle Content-Length header
    if (line.startsWith('Content-Length: ')) {
      this.expectedLength = parseInt(line.substring(16), 10);
      return;
    }

    // Skip empty lines
    if (line.trim() === '') {
      return;
    }

    // If we're not expecting a specific length, try to parse as JSON directly
    if (this.expectedLength === 0) {
      this.processMessage(line).catch(error => {
        console.error('Error processing message:', error);
      });
      return;
    }

    // Add to buffer
    this.messageBuffer += line;

    // Check if we have the complete message
    if (this.messageBuffer.length >= this.expectedLength) {
      const message = this.messageBuffer.substring(0, this.expectedLength);
      this.messageBuffer = this.messageBuffer.substring(this.expectedLength);
      this.expectedLength = 0;

      this.processMessage(message).catch(error => {
        console.error('Error processing message:', error);
      });
    }
  }

  private async processMessage(messageStr: string): Promise<void> {
    let message: any;

    try {
      message = JSON.parse(messageStr.trim());
      
      // Use Claude-flow pattern validation
      this.validateMessage(message);
    } catch (error) {
      // Send error response if we can extract an ID
      let id = 'unknown';
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
    try {
      const json = JSON.stringify(notification);
      stdout.write(json + '\n');
    } catch (error) {
      throw error;
    }
  }

  // Claude-flow pattern: Transport error handling with reconnection
  private async handleTransportError(error: Error): Promise<void> {
    console.error('StdioTransport error:', error);
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts}...`);
      
      await new Promise(resolve => setTimeout(resolve, this.reconnectDelay));
      
      try {
        await this.restart();
        this.reconnectAttempts = 0;
        console.log('Reconnection successful');
      } catch (restartError) {
        await this.handleTransportError(restartError as Error);
      }
    } else {
      console.error('Max reconnection attempts reached, giving up');
      process.exit(1);
    }
  }

  private async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  // Claude-flow pattern: Message validation
  private validateMessage(message: any): void {
    if (!message.jsonrpc || message.jsonrpc !== '2.0') {
      throw new Error('Invalid JSON-RPC version');
    }
    
    if (message.id !== undefined) {
      // Request validation
      if (!message.method || typeof message.method !== 'string') {
        throw new Error('Invalid request: missing method');
      }
    } else {
      // Notification validation
      if (!message.method || typeof message.method !== 'string') {
        throw new Error('Invalid notification: missing method');
      }
    }
  }
}