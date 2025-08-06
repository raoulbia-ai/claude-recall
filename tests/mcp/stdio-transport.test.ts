import { StdioTransport } from '../../src/mcp/transports/stdio';
import { Readable, Writable } from 'stream';

describe('StdioTransport Resilience', () => {
  let transport: StdioTransport;
  let mockStdin: Readable;
  let mockStdout: Writable;
  let originalStdin: any;
  let originalStdout: any;

  beforeEach(() => {
    // Save original stdin/stdout
    originalStdin = process.stdin;
    originalStdout = process.stdout;

    // Create mock streams
    mockStdin = new Readable({
      read() {}
    });
    mockStdout = new Writable({
      write(chunk, encoding, callback) {
        if (callback) callback();
        return true;
      }
    });

    // Replace process streams
    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      configurable: true
    });
    Object.defineProperty(process, 'stdout', {
      value: mockStdout,
      configurable: true
    });

    transport = new StdioTransport();
  });

  afterEach(async () => {
    await transport.stop();
    
    // Restore original streams
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true
    });
    Object.defineProperty(process, 'stdout', {
      value: originalStdout,
      configurable: true
    });
  });

  describe('Message Validation', () => {
    it('should validate JSON-RPC version', async () => {
      const responses: any[] = [];
      const mockWrite = jest.fn((chunk) => {
        const data = chunk.toString();
        if (data.trim()) {
          responses.push(JSON.parse(data));
        }
        return true;
      });
      mockStdout.write = mockWrite as any;

      await transport.start();
      transport.onRequest(async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: { success: true }
      }));

      // Send invalid JSON-RPC version
      mockStdin.push(JSON.stringify({
        jsonrpc: "1.0",
        id: 1,
        method: "test"
      }) + '\n');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(responses).toHaveLength(1);
      expect(responses[0].error).toBeDefined();
      expect(responses[0].error.code).toBe(-32700);
      expect(responses[0].error.message).toBe('Parse error');
    });

    it('should validate request has method', async () => {
      const responses: any[] = [];
      const mockWrite = jest.fn((chunk) => {
        const data = chunk.toString();
        if (data.trim()) {
          responses.push(JSON.parse(data));
        }
        return true;
      });
      mockStdout.write = mockWrite as any;

      await transport.start();

      // Send request without method
      mockStdin.push(JSON.stringify({
        jsonrpc: "2.0",
        id: 1
      }) + '\n');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(responses).toHaveLength(1);
      expect(responses[0].error).toBeDefined();
      expect(responses[0].error.code).toBe(-32700);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON gracefully', async () => {
      const responses: any[] = [];
      const mockWrite = jest.fn((chunk) => {
        const data = chunk.toString();
        if (data.trim()) {
          try {
            responses.push(JSON.parse(data));
          } catch (e) {
            // Ignore parse errors in test
          }
        }
        return true;
      });
      mockStdout.write = mockWrite as any;

      await transport.start();

      // Send various malformed inputs
      mockStdin.push('not json at all\n');
      mockStdin.push('{"incomplete": \n');
      mockStdin.push('{]\n');
      
      // Then send valid request
      mockStdin.push(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "test"
      }) + '\n');

      // Set up request handler
      transport.onRequest(async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: { received: true }
      }));

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have error responses for malformed JSON
      const errorResponses = responses.filter(r => r.error && r.error.code === -32700);
      expect(errorResponses.length).toBeGreaterThan(0);

      // Should still process valid request
      const validResponse = responses.find(r => r.id === 2 && r.result);
      expect(validResponse).toBeDefined();
      expect(validResponse.result.received).toBe(true);
    });

    it('should handle request handler errors', async () => {
      const responses: any[] = [];
      const mockWrite = jest.fn((chunk) => {
        const data = chunk.toString();
        if (data.trim()) {
          responses.push(JSON.parse(data));
        }
        return true;
      });
      mockStdout.write = mockWrite as any;

      await transport.start();

      // Set up failing request handler
      transport.onRequest(async (request) => {
        throw new Error('Handler error');
      });

      mockStdin.push(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "test"
      }) + '\n');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(responses).toHaveLength(1);
      expect(responses[0].error).toBeDefined();
      expect(responses[0].error.code).toBe(-32603);
      expect(responses[0].error.message).toBe('Internal error');
      expect(responses[0].error.data).toBe('Handler error');
    });
  });

  describe('Content-Length Handling', () => {
    it('should handle Content-Length headers', async () => {
      const responses: any[] = [];
      const mockWrite = jest.fn((chunk) => {
        const data = chunk.toString();
        if (data.trim()) {
          responses.push(JSON.parse(data));
        }
        return true;
      });
      mockStdout.write = mockWrite as any;

      await transport.start();
      transport.onRequest(async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: { method: request.method }
      }));

      const message = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "test"
      });

      // Send with Content-Length header
      mockStdin.push(`Content-Length: ${message.length}\n`);
      mockStdin.push('\n');
      mockStdin.push(message + '\n'); // Add newline for readline to process

      // Wait for processing - increase timeout for reliability
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(responses).toHaveLength(1);
      expect(responses[0].result).toBeDefined();
      expect(responses[0].result.method).toBe('test');
    });

    it('should handle messages without Content-Length', async () => {
      const responses: any[] = [];
      const mockWrite = jest.fn((chunk) => {
        const data = chunk.toString();
        if (data.trim()) {
          responses.push(JSON.parse(data));
        }
        return true;
      });
      mockStdout.write = mockWrite as any;

      await transport.start();
      transport.onRequest(async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: { method: request.method }
      }));

      // Send without Content-Length header
      mockStdin.push(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "direct"
      }) + '\n');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(responses).toHaveLength(1);
      expect(responses[0].result).toBeDefined();
      expect(responses[0].result.method).toBe('direct');
    });
  });

  describe('Notification Handling', () => {
    it('should handle notifications (no id field)', async () => {
      const notifications: any[] = [];
      
      await transport.start();
      transport.onNotification(async (notification) => {
        notifications.push(notification);
      });

      // Send notification (no id field)
      mockStdin.push(JSON.stringify({
        jsonrpc: "2.0",
        method: "notification/test",
        params: { data: "test" }
      }) + '\n');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(notifications).toHaveLength(1);
      expect(notifications[0].method).toBe('notification/test');
      expect(notifications[0].params.data).toBe('test');
    });

    it('should not send response for notifications', async () => {
      const responses: any[] = [];
      const mockWrite = jest.fn((chunk) => {
        const data = chunk.toString();
        if (data.trim()) {
          responses.push(JSON.parse(data));
        }
        return true;
      });
      mockStdout.write = mockWrite as any;

      await transport.start();
      transport.onNotification(async (notification) => {
        // Process notification
      });

      // Send notification
      mockStdin.push(JSON.stringify({
        jsonrpc: "2.0",
        method: "notification/test"
      }) + '\n');

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      // Should not send any response for notifications
      expect(responses).toHaveLength(0);
    });
  });
});