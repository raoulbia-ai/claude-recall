import { spawn } from 'child_process';
import { MCPTestClient } from '../utils/mcp-test-client';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Claude Code MCP Integration', () => {
  let mcpProcess: any;
  let client: MCPTestClient;
  const activeProcesses: any[] = [];

  beforeAll(async () => {
    // Start MCP server
    mcpProcess = spawn('node', ['dist/cli/claude-recall-cli.js', 'mcp', 'start']);
    client = new MCPTestClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    
    // Kill main process
    if (mcpProcess) {
      mcpProcess.kill('SIGTERM');
      activeProcesses.push(mcpProcess);
    }
    
    // Kill all tracked processes
    for (const proc of activeProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch (e) {
        // Already dead
      }
    }
    
    // Give them time to shut down
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Force kill any remaining
    for (const proc of activeProcesses) {
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        // Already dead
      }
    }
  });

  describe('Protocol Compliance', () => {
    it('should respond to initialize with correct version', async () => {
      const response = await client.request('initialize', {});
      expect(response.result.protocolVersion).toBe('2024-11-05');
      expect(response.result.serverInfo.name).toBe('claude-recall');
    });

    it('should list all registered tools', async () => {
      const response = await client.request('tools/list', {});
      // Server registers 2 core memory tools (load_rules + store_memory)
      expect(response.result.tools.length).toBeGreaterThanOrEqual(2);

      // Verify core memory tools are present
      const toolNames = response.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('mcp__claude-recall__store_memory');
      expect(toolNames).toContain('mcp__claude-recall__load_rules');
    });

    it('should have proper tool schemas', async () => {
      const response = await client.request('tools/list', {});
      const storeMemoryTool = response.result.tools.find((t: any) => t.name === 'mcp__claude-recall__store_memory');
      
      expect(storeMemoryTool).toBeDefined();
      expect(storeMemoryTool.inputSchema).toBeDefined();
      expect(storeMemoryTool.inputSchema.type).toBe('object');
      expect(storeMemoryTool.inputSchema.properties.content).toBeDefined();
      expect(storeMemoryTool.inputSchema.required).toContain('content');
    });
  });

  describe('Memory Operations', () => {
    it('should store and retrieve memories', async () => {
      // Store a memory
      const storeResponse = await client.request('tools/call', {
        name: 'mcp__claude-recall__store_memory',
        arguments: {
          content: 'Test memory content',
          metadata: { type: 'preference', test: true }
        }
      });

      const storeResult = JSON.parse(storeResponse.result.content[0].text);
      expect(storeResult.success).toBe(true);
      expect(storeResult.activeRule).toContain('Test memory content');
      expect(storeResult.type).toBe('preference');

      // Retrieve it via load_rules
      const rulesResponse = await client.request('tools/call', {
        name: 'mcp__claude-recall__load_rules',
        arguments: {}
      });

      const rules = JSON.parse(rulesResponse.result.content[0].text);
      expect(rules.counts.total).toBeGreaterThan(0);
    });

    it('should handle metadata correctly', async () => {
      const metadata = {
        type: 'correction',
        tags: ['test', 'integration'],
        priority: 'high'
      };

      const storeResponse = await client.request('tools/call', {
        name: 'mcp__claude-recall__store_memory',
        arguments: {
          content: 'Memory with complex metadata',
          metadata
        }
      });

      const storeResult = JSON.parse(storeResponse.result.content[0].text);
      expect(storeResult.success).toBe(true);
      expect(storeResult.type).toBe('correction');
    });

    it('should store multiple memories and load via rules', async () => {
      // Store multiple memories with unique timestamp
      const timestamp = Date.now();
      for (let i = 0; i < 3; i++) {
        await client.request('tools/call', {
          name: 'mcp__claude-recall__store_memory',
          arguments: {
            content: `Test preference ${timestamp}-${i}`,
            metadata: { type: 'preference', index: i, testRun: timestamp }
          }
        });
      }

      // Load rules to verify they're included
      const rulesResponse = await client.request('tools/call', {
        name: 'mcp__claude-recall__load_rules',
        arguments: {}
      });

      const rules = JSON.parse(rulesResponse.result.content[0].text);
      expect(rules.counts.preferences).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Session Persistence', () => {
    it('should maintain session across restarts', async () => {
      // Load initial rules count
      const rules1 = await client.request('tools/call', {
        name: 'mcp__claude-recall__load_rules',
        arguments: {}
      });

      const initialTotal = JSON.parse(rules1.result.content[0].text).counts.total;

      // Store a unique memory
      const uniqueContent = `Session test preference ${Date.now()}`;
      await client.request('tools/call', {
        name: 'mcp__claude-recall__store_memory',
        arguments: {
          content: uniqueContent,
          metadata: { type: 'preference', sessionTest: true }
        }
      });

      // Restart server
      mcpProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 1000));
      mcpProcess = spawn('node', ['dist/cli/claude-recall-cli.js', 'mcp', 'start']);
      await new Promise(resolve => setTimeout(resolve, 500)); // Wait for startup
      await client.reconnect();

      // Verify session persisted via load_rules
      const rules2 = await client.request('tools/call', {
        name: 'mcp__claude-recall__load_rules',
        arguments: {}
      });

      const newTotal = JSON.parse(rules2.result.content[0].text).counts.total;
      expect(newTotal).toBeGreaterThan(initialTotal);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid tool calls gracefully', async () => {
      const response = await client.request('tools/call', {
        name: 'mcp__claude-recall__invalid_tool',
        arguments: {}
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Tool not found');
    });

    it('should validate required parameters', async () => {
      const response = await client.request('tools/call', {
        name: 'mcp__claude-recall__store_memory',
        arguments: {} // Missing required 'content' parameter
      });

      // The tool should throw an error, not return success
      expect(response.result).toBeDefined();
      // The error is thrown and caught, returning an error message
      const resultText = response.result.content[0].text;
      expect(resultText).toContain('required');
    });

    it('should handle calling removed tools gracefully', async () => {
      // Calling a removed tool should return "Tool not found"
      const response = await client.request('tools/call', {
        name: 'mcp__claude-recall__clear_context',
        arguments: { confirm: true }
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Tool not found');
    });
  });


});