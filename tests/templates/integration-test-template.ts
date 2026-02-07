/**
 * Integration Test Template
 *
 * This template provides a starting point for MCP integration tests.
 * Integration tests verify that the MCP server works correctly with the protocol.
 *
 * Key features:
 * - Spawns actual MCP server process
 * - Communicates via JSON-RPC (just like Claude Code)
 * - Tests full request/response cycle
 * - Tests protocol compliance
 *
 * Usage:
 * 1. Copy this file to tests/integration/your-feature.test.ts
 * 2. Replace 'YourMCPFeature' with your feature name
 * 3. Write tests that call MCP tools
 * 4. Run: npx jest tests/integration/your-feature.test.ts
 *
 * Prerequisites:
 * - Project must be built: npm run build
 * - MCPTestClient utility is available in tests/utils/
 */

import { spawn } from 'child_process';
import { MCPTestClient } from '../utils/mcp-test-client';

describe('YourMCPFeature Integration', () => {
  let mcpProcess: any;
  let client: MCPTestClient;
  const activeProcesses: any[] = [];

  beforeAll(async () => {
    // Start the MCP server as a child process
    mcpProcess = spawn('node', ['dist/cli/claude-recall-cli.js', 'mcp', 'start']);

    // Create and connect test client
    client = new MCPTestClient();
    await client.connect();

    // Track process for cleanup
    activeProcesses.push(mcpProcess);
  });

  afterAll(async () => {
    // Disconnect client
    await client.disconnect();

    // Kill MCP server
    if (mcpProcess) {
      mcpProcess.kill('SIGTERM');
    }

    // Kill all tracked processes
    for (const proc of activeProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch (e) {
        // Process already terminated
      }
    }

    // Give processes time to shut down gracefully
    await new Promise(resolve => setTimeout(resolve, 500));

    // Force kill any remaining processes
    for (const proc of activeProcesses) {
      try {
        proc.kill('SIGKILL');
      } catch (e) {
        // Process already terminated
      }
    }
  });

  describe('MCP Protocol Compliance', () => {
    it('should respond to tool list request', async () => {
      const response = await client.request('tools/list', {});

      expect(response.result).toBeDefined();
      expect(response.result.tools).toBeInstanceOf(Array);
      expect(response.result.tools.length).toBeGreaterThan(0);
    });

    it('should have proper tool schema', async () => {
      const response = await client.request('tools/list', {});
      const yourTool = response.result.tools.find((t: any) =>
        t.name === 'mcp__claude-recall__your_tool'
      );

      expect(yourTool).toBeDefined();
      expect(yourTool.inputSchema).toBeDefined();
      expect(yourTool.inputSchema.type).toBe('object');
      expect(yourTool.inputSchema.properties).toBeDefined();
    });
  });

  describe('Feature Functionality', () => {
    it('should execute tool successfully', async () => {
      // Call your MCP tool
      const response = await client.request('tools/call', {
        name: 'mcp__claude-recall__your_tool',
        arguments: {
          // Your tool arguments
          param1: 'value1',
          param2: 'value2'
        }
      });

      // Verify response structure
      expect(response.result).toBeDefined();
      expect(response.result.content).toBeDefined();
      expect(response.result.content[0].type).toBe('text');

      // Parse and verify result
      const resultText = response.result.content[0].text;
      expect(resultText).toContain('expected content');
    });

    it('should handle multiple sequential calls', async () => {
      // First call
      const response1 = await client.request('tools/call', {
        name: 'mcp__claude-recall__store_memory',
        arguments: {
          content: 'First memory',
          metadata: { order: 1 }
        }
      });
      expect(response1.result.content[0].text).toContain('"success": true');

      // Second call
      const response2 = await client.request('tools/call', {
        name: 'mcp__claude-recall__store_memory',
        arguments: {
          content: 'Second memory',
          metadata: { order: 2 }
        }
      });
      expect(response2.result.content[0].text).toContain('"success": true');

      // Verify both exist via load_rules
      const rulesResponse = await client.request('tools/call', {
        name: 'mcp__claude-recall__load_rules',
        arguments: {}
      });

      const rules = JSON.parse(rulesResponse.result.content[0].text);
      expect(rules.counts.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid tool name', async () => {
      const response = await client.request('tools/call', {
        name: 'mcp__claude-recall__nonexistent_tool',
        arguments: {}
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Tool not found');
    });

    it('should validate required parameters', async () => {
      const response = await client.request('tools/call', {
        name: 'mcp__claude-recall__your_tool',
        arguments: {
          // Missing required parameters
        }
      });

      // Tool should return error or handle gracefully
      expect(response.result).toBeDefined();
      const resultText = response.result.content[0].text;
      expect(resultText).toContain('required');
    });
  });

  describe('State Persistence', () => {
    it('should maintain state across multiple calls', async () => {
      const uniqueContent = `Test memory ${Date.now()}`;

      // Store memory
      await client.request('tools/call', {
        name: 'mcp__claude-recall__store_memory',
        arguments: {
          content: uniqueContent,
          metadata: { persistent: true }
        }
      });

      // Retrieve via load_rules
      const rulesResponse = await client.request('tools/call', {
        name: 'mcp__claude-recall__load_rules',
        arguments: {}
      });

      const rules = JSON.parse(rulesResponse.result.content[0].text);
      expect(rules.counts.total).toBeGreaterThan(0);
    });
  });
});
