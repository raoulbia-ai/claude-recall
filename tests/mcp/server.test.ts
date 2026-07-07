/**
 * Unit tests for src/mcp/server.ts (MCPServer).
 *
 * The server wires a StdioTransport in its constructor; the real transport
 * reads process.stdin via readline. Here the transport is mocked with a class
 * that CAPTURES the onRequest/onNotification/onClose handlers, so tests drive
 * the server by invoking the captured request handler directly with JSON-RPC
 * request objects — no real stdin involved.
 *
 * ProcessManager is mocked (PID files live under the real ~/.claude-recall/pids
 * via os.homedir), as is SearchMonitor (logs under os.homedir directly). The
 * database/log/project paths are redirected to a mkdtemp dir BEFORE the server
 * module is required, so the real ~/.claude-recall is never touched.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- Captured transport handlers (populated when MCPServer constructs its transport) ---
const mockCaptured: {
  onRequest?: (request: any) => Promise<any>;
  onNotification?: (notification: any) => Promise<void>;
  onClose?: () => void;
  start: jest.Mock;
  stop: jest.Mock;
  sendNotification: jest.Mock;
} = {
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  sendNotification: jest.fn().mockResolvedValue(undefined),
};

jest.mock('../../src/mcp/transports/stdio', () => ({
  StdioTransport: class {
    onRequest(handler: any) { mockCaptured.onRequest = handler; }
    onNotification(handler: any) { mockCaptured.onNotification = handler; }
    onClose(handler: any) { mockCaptured.onClose = handler; }
    start = mockCaptured.start;
    stop = mockCaptured.stop;
    sendNotification = mockCaptured.sendNotification;
  },
}));

// PID files live under ~/.claude-recall/pids (os.homedir, NOT the env-redirected
// db path) — never let the server touch them.
const mockProcessManager = {
  readPidFile: jest.fn().mockReturnValue(null),
  writePidFile: jest.fn(),
  removePidFile: jest.fn(),
  isProcessRunning: jest.fn().mockReturnValue(false),
  killProcess: jest.fn(),
};

jest.mock('../../src/services/process-manager', () => ({
  ProcessManager: { getInstance: () => mockProcessManager },
}));

// SearchMonitor writes its log under os.homedir()/.claude-recall directly
const mockSearchMonitor = { recordSearch: jest.fn() };
jest.mock('../../src/services/search-monitor', () => ({
  SearchMonitor: { getInstance: () => mockSearchMonitor },
}));

const ENV_KEYS = [
  'CLAUDE_RECALL_DB_PATH',
  'CLAUDE_RECALL_LOG_DIR',
  'CLAUDE_PROJECT_DIR',
  'CLAUDE_PROJECT_ID',
] as const;

const PROJECT = 'server-test-project';

const EXPECTED_TOOLS = [
  'load_rules',
  'store_memory',
  'search_memory',
  'delete_memory',
  'save_checkpoint',
  'load_checkpoint',
];

describe('MCPServer', () => {
  let testDir: string;
  let savedEnv: Record<string, string | undefined>;
  let server: any;
  let requestId = 0;

  async function send(method: string, params?: any): Promise<any> {
    requestId += 1;
    return mockCaptured.onRequest!({ jsonrpc: '2.0', id: requestId, method, params });
  }

  async function callTool(name: string, args?: any): Promise<any> {
    return send('tools/call', { name, arguments: args });
  }

  beforeAll(() => {
    savedEnv = {};
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }

    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-recall-mcpserver-'));
    process.env.CLAUDE_RECALL_DB_PATH = testDir;
    process.env.CLAUDE_RECALL_LOG_DIR = path.join(testDir, 'logs');
    process.env.CLAUDE_PROJECT_DIR = testDir;
    process.env.CLAUDE_PROJECT_ID = PROJECT;

    // Require AFTER env isolation so the ConfigService singleton (and every
    // service derived from it) resolves paths inside the temp dir.
    jest.resetModules();
    const { MCPServer } = require('../../src/mcp/server');
    server = new MCPServer();
  });

  afterAll(async () => {
    // stop() clears the SessionManager persist interval and RateLimiter
    // cleanup interval, and closes the temp-dir database.
    await server.stop();
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('registers transport handlers, including a close handler (not invoked — it exits the process)', () => {
      expect(typeof mockCaptured.onRequest).toBe('function');
      expect(typeof mockCaptured.onNotification).toBe('function');
      expect(typeof mockCaptured.onClose).toBe('function');
    });
  });

  describe('initialize', () => {
    it('returns protocol version, capabilities, and the real package.json version', async () => {
      const response = await send('initialize', { clientInfo: { name: 'test-client' } });

      expect(response.error).toBeUndefined();
      expect(response.result.protocolVersion).toBe('2024-11-05');
      expect(response.result.capabilities).toMatchObject({
        tools: {},
        resources: {},
        prompts: {},
        logging: {},
      });
      expect(response.result.serverInfo.name).toBe('claude-recall');

      const pkgVersion = require('../../package.json').version;
      expect(response.result.serverInfo.version).toBe(pkgVersion);
      expect(response.result.serverInfo.version).not.toBe('0.2.0');
    });
  });

  describe('tools/list', () => {
    it('lists at least 6 tools, each with name, description, and inputSchema', async () => {
      const response = await send('tools/list');

      expect(response.error).toBeUndefined();
      const tools = response.result.tools;
      expect(tools.length).toBeGreaterThanOrEqual(6);

      const names = tools.map((t: any) => t.name);
      for (const expected of EXPECTED_TOOLS) {
        expect(names).toContain(expected);
      }

      for (const tool of tools) {
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.inputSchema).toMatchObject({ type: 'object' });
        expect(tool.inputSchema.properties).toBeDefined();
      }
    });
  });

  describe('tools/call', () => {
    it('store_memory then load_rules succeed with the enhanced response shape and a stable sessionId', async () => {
      const storeResponse = await callTool('store_memory', {
        content: 'test rule alpha: run the linter before committing',
      });

      expect(storeResponse.error).toBeUndefined();
      expect(storeResponse.result.isError).toBe(false);
      expect(storeResponse.result.content[0].type).toBe('text');
      expect(storeResponse.result.metadata.toolName).toBe('store_memory');
      expect(storeResponse.result.metadata.sessionId).toEqual(expect.any(String));

      const stored = JSON.parse(storeResponse.result.content[0].text);
      expect(stored.success).toBe(true);
      expect(stored.id).toEqual(expect.any(String));

      const loadResponse = await callTool('load_rules', {});

      expect(loadResponse.error).toBeUndefined();
      expect(loadResponse.result.isError).toBe(false);
      expect(loadResponse.result.content[0].type).toBe('text');
      expect(loadResponse.result.content[0].text).toContain('test rule alpha');

      // The per-process session id is IDENTICAL across calls — one stdio
      // server serves exactly one client.
      expect(loadResponse.result.metadata.sessionId).toBe(storeResponse.result.metadata.sessionId);
    });

    it('returns -32601 for an unknown tool', async () => {
      const response = await callTool('definitely_not_a_tool', {});

      expect(response.result).toBeUndefined();
      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toContain('definitely_not_a_tool');
    });

    it('returns -32602 when the tool name is missing', async () => {
      const response = await send('tools/call', { arguments: {} });

      expect(response.error.code).toBe(-32602);
    });

    it('wraps handler throws as isError results with the stable sessionId and no stack trace', async () => {
      // store_memory without content throws inside the handler
      const response = await callTool('store_memory', {});

      expect(response.error).toBeUndefined();
      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].type).toBe('text');
      expect(response.result.content[0].text).toContain('Tool execution failed');
      expect(response.result.metadata.error.message).toContain('Content is required');
      // Stack traces are intentionally omitted from the wire response
      expect(response.result.metadata.error.stack).toBeUndefined();
      expect(JSON.stringify(response)).not.toContain('at Object');

      // Same stable per-process session id, even on the failure path
      const ok = await callTool('load_rules', {});
      expect(response.result.metadata.sessionId).toBe(ok.result.metadata.sessionId);
    });
  });

  describe('other methods', () => {
    it('returns an empty result for ping', async () => {
      const response = await send('ping');

      expect(response.error).toBeUndefined();
      expect(response.result).toEqual({});
    });

    it('returns -32601 for an unknown method', async () => {
      const response = await send('no/such/method');

      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toContain('no/such/method');
    });
  });

  describe('notifications', () => {
    it('handles notifications/initialized without throwing (and without a response)', async () => {
      await expect(
        mockCaptured.onNotification!({ jsonrpc: '2.0', method: 'notifications/initialized' })
      ).resolves.toBeUndefined();
    });

    it('ignores unknown notifications', async () => {
      await expect(
        mockCaptured.onNotification!({ jsonrpc: '2.0', method: 'notifications/whatever' })
      ).resolves.toBeUndefined();
    });
  });

  describe('start', () => {
    it('starts the transport and writes a PID file for the current project', async () => {
      mockProcessManager.readPidFile.mockReturnValueOnce(null);

      await server.start();

      expect(mockCaptured.start).toHaveBeenCalled();
      expect(mockProcessManager.writePidFile).toHaveBeenCalledWith(PROJECT, process.pid);
    });

    it('removes a stale PID file when the recorded process is not running', async () => {
      mockProcessManager.readPidFile.mockReturnValueOnce(424242);
      mockProcessManager.isProcessRunning.mockReturnValueOnce(false);
      mockProcessManager.removePidFile.mockClear();

      await server.start();

      expect(mockProcessManager.removePidFile).toHaveBeenCalledWith(PROJECT);
      expect(mockProcessManager.killProcess).not.toHaveBeenCalled();
    });
  });
});
