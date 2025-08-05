import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class MCPTestClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private messageBuffer: string = '';
  private pendingRequests: Map<number | string, {
    resolve: (value: JsonRpcResponse) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private requestId: number = 1;

  constructor(private command: string = 'node', private args: string[] = ['dist/cli/claude-recall-cli.js', 'mcp', 'start']) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.command, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test' }
      });

      this.process.stdout?.on('data', (data) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on('data', (data) => {
        console.error('MCP Server Error:', data.toString());
      });

      this.process.on('error', (error) => {
        reject(error);
      });

      this.process.on('exit', (code, signal) => {
        this.emit('exit', { code, signal });
      });

      // Wait for server to be ready
      setTimeout(() => resolve(), 1000);
    });
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (this.process.exitCode === null) {
        this.process.kill('SIGKILL');
      }
      this.process = null;
    }
  }

  async reconnect(): Promise<void> {
    await this.disconnect();
    await this.connect();
  }

  async request(method: string, params?: any): Promise<JsonRpcResponse> {
    const id = this.requestId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 5000);
      
      // Store resolve, reject, and timeoutId
      this.pendingRequests.set(id, { 
        resolve: (value: JsonRpcResponse) => {
          clearTimeout(timeoutId);
          resolve(value);
        },
        reject: (error: Error) => {
          clearTimeout(timeoutId);
          reject(error);
        }
      });
      
      const message = JSON.stringify(request) + '\n';
      this.process?.stdin?.write(message);
    });
  }

  private handleData(data: string): void {
    this.messageBuffer += data;
    
    // Process complete messages
    const lines = this.messageBuffer.split('\n');
    this.messageBuffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          if (message.id && this.pendingRequests.has(message.id)) {
            const { resolve } = this.pendingRequests.get(message.id)!;
            this.pendingRequests.delete(message.id);
            resolve(message);
          } else {
            // Handle notifications
            this.emit('notification', message);
          }
        } catch (error) {
          console.error('Failed to parse message:', line, error);
        }
      }
    }
  }

  // Helper methods for common MCP operations
  async initialize(params: any = {}): Promise<any> {
    const response = await this.request('initialize', params);
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  async listTools(): Promise<any> {
    const response = await this.request('tools/list');
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  async callTool(name: string, args: any): Promise<any> {
    const response = await this.request('tools/call', { name, arguments: args });
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }

  async checkHealth(): Promise<any> {
    const response = await this.request('health/check');
    if (response.error) {
      throw new Error(response.error.message);
    }
    return response.result;
  }
}