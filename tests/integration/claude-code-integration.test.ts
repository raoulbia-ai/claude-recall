import { MCPTestClient } from '../utils/mcp-test-client';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

describe('Claude Code MCP Integration', () => {
  let client: MCPTestClient;
  let testDbDir: string;

  beforeAll(async () => {
    // Use a temporary directory so test data never pollutes the production DB
    testDbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-recall-test-'));

    // MCPTestClient spawns its own server process — pass DB path via env
    client = new MCPTestClient(
      'node',
      ['dist/cli/claude-recall-cli.js', 'mcp', 'start'],
      { CLAUDE_RECALL_DB_PATH: testDbDir },
    );
    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();

    // Clean up temp DB directory
    if (testDbDir) {
      await fs.rm(testDbDir, { recursive: true, force: true }).catch(() => {});
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
      expect(toolNames).toContain('store_memory');
      expect(toolNames).toContain('load_rules');
    });

    it('should have proper tool schemas', async () => {
      const response = await client.request('tools/list', {});
      const storeMemoryTool = response.result.tools.find((t: any) => t.name === 'store_memory');
      
      expect(storeMemoryTool).toBeDefined();
      expect(storeMemoryTool.inputSchema).toBeDefined();
      expect(storeMemoryTool.inputSchema.type).toBe('object');
      expect(storeMemoryTool.inputSchema.properties.content).toBeDefined();
      expect(storeMemoryTool.inputSchema.required).toContain('content');
    });
  });

  describe('Memory Operations', () => {
    it('should store and retrieve memories', async () => {
      // Fixture value avoids the test-pollution guard (patterns like "Test memory content"
      // are blocked at write-time by MemoryService.store — see services/test-pollution.ts).
      const fixture = `integration-fixture memory ${Date.now()}`;
      const storeResponse = await client.request('tools/call', {
        name: 'store_memory',
        arguments: {
          content: fixture,
          metadata: { type: 'preference', test: true }
        }
      });

      const storeResult = JSON.parse(storeResponse.result.content[0].text);
      expect(storeResult.success).toBe(true);
      expect(storeResult.activeRule).toContain(fixture);
      expect(storeResult.type).toBe('preference');

      // Retrieve it via load_rules
      const rulesResponse = await client.request('tools/call', {
        name: 'load_rules',
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

      const fixture = `integration-fixture correction ${Date.now()}`;
      const storeResponse = await client.request('tools/call', {
        name: 'store_memory',
        arguments: {
          content: fixture,
          metadata
        }
      });

      const storeResult = JSON.parse(storeResponse.result.content[0].text);
      expect(storeResult.success).toBe(true);
      expect(storeResult.type).toBe('correction');
    });

    it('should store multiple memories and load via rules', async () => {
      // Unique timestamp prevents collision across test runs.
      const timestamp = Date.now();
      for (let i = 0; i < 3; i++) {
        await client.request('tools/call', {
          name: 'store_memory',
          arguments: {
            content: `integration-fixture preference ${timestamp}-${i}`,
            metadata: { type: 'preference', index: i, testRun: timestamp }
          }
        });
      }

      // Load rules to verify they're included
      const rulesResponse = await client.request('tools/call', {
        name: 'load_rules',
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
        name: 'load_rules',
        arguments: {}
      });

      const initialTotal = JSON.parse(rules1.result.content[0].text).counts.total;

      // Store a unique memory — "integration-fixture" prefix avoids the write-time guard.
      const uniqueContent = `integration-fixture session ${Date.now()}`;
      await client.request('tools/call', {
        name: 'store_memory',
        arguments: {
          content: uniqueContent,
          metadata: { type: 'preference', sessionTest: true }
        }
      });

      // Restart server (client reconnect kills and re-spawns with same env)
      await client.reconnect();

      // Verify session persisted via load_rules
      const rules2 = await client.request('tools/call', {
        name: 'load_rules',
        arguments: {}
      });

      const newTotal = JSON.parse(rules2.result.content[0].text).counts.total;
      expect(newTotal).toBeGreaterThan(initialTotal);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid tool calls gracefully', async () => {
      const response = await client.request('tools/call', {
        name: 'invalid_tool',
        arguments: {}
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Tool not found');
    });

    it('should validate required parameters', async () => {
      const response = await client.request('tools/call', {
        name: 'store_memory',
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
        name: 'clear_context',
        arguments: { confirm: true }
      });

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Tool not found');
    });
  });


});