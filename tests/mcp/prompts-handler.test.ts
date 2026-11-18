/**
 * Tests for PromptsHandler — MCP prompts/list and prompts/get.
 */

const mockLoadActiveRules = jest.fn().mockReturnValue({
  preferences: [], corrections: [], failures: [], devops: [], summary: '',
});
const mockSearch = jest.fn().mockReturnValue([]);
const mockSearchByContext = jest.fn().mockReturnValue([]);

jest.mock('../../src/services/memory', () => ({
  MemoryService: {
    getInstance: () => ({
      loadActiveRules: mockLoadActiveRules,
      search: mockSearch,
      getStorage: () => ({ searchByContext: mockSearchByContext }),
    }),
  },
}));

jest.mock('../../src/services/config', () => ({
  ConfigService: {
    getInstance: () => ({
      getProjectId: () => 'test-project',
      getDatabasePath: () => ':memory:',
      getConfig: () => ({ database: {}, project: { rootDir: '/tmp' } }),
    }),
  },
}));

jest.mock('../../src/services/logging', () => ({
  LoggingService: {
    getInstance: () => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  },
}));

const mockGetCandidateLessons = jest.fn().mockReturnValue([]);

jest.mock('../../src/services/outcome-storage', () => ({
  OutcomeStorage: {
    getInstance: () => ({
      getCandidateLessons: mockGetCandidateLessons,
    }),
  },
}));

import { PromptsHandler } from '../../src/mcp/prompts-handler';

function makeRequest(name: string, args?: any) {
  return {
    jsonrpc: '2.0' as const,
    id: 1,
    method: 'prompts/get',
    params: { name, arguments: args },
  };
}

describe('PromptsHandler', () => {
  let handler: PromptsHandler;

  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadActiveRules.mockReturnValue({
      preferences: [], corrections: [], failures: [], devops: [], summary: '',
    });
    mockGetCandidateLessons.mockReturnValue([]);
    handler = new PromptsHandler();
  });

  describe('prompts/list', () => {
    it('returns 6 prompts', async () => {
      const response = await handler.handlePromptsList({
        jsonrpc: '2.0', id: 1, method: 'prompts/list',
      });

      expect(response.result.prompts).toHaveLength(6);
    });

    it('includes load-rules prompt', async () => {
      const response = await handler.handlePromptsList({
        jsonrpc: '2.0', id: 1, method: 'prompts/list',
      });

      const names = response.result.prompts.map((p: any) => p.name);
      expect(names).toContain('load-rules');
      expect(names).not.toContain('session-review');
    });

    it('all prompts have name and description', async () => {
      const response = await handler.handlePromptsList({
        jsonrpc: '2.0', id: 1, method: 'prompts/list',
      });

      for (const prompt of response.result.prompts) {
        expect(prompt.name).toBeDefined();
        expect(typeof prompt.name).toBe('string');
        expect(prompt.description).toBeDefined();
        expect(typeof prompt.description).toBe('string');
      }
    });
  });

  describe('load-rules prompt', () => {
    it('returns structured markdown with sections', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [
          { key: 'p1', value: { content: 'Use TypeScript' } },
        ],
        corrections: [
          { key: 'c1', value: { content: 'Never use var' } },
        ],
        failures: [
          { key: 'f1', value: { content: 'npm test fails without NODE_ENV' } },
        ],
        devops: [
          { key: 'd1', value: { content: 'Run lint before push' } },
        ],
        summary: 'Loaded',
      });

      const response = await handler.handlePromptsGet(makeRequest('load-rules'));

      const content = response.result.messages[0].content.text;
      expect(content).toContain('# Active Rules');
      expect(content).toContain('## Preferences');
      expect(content).toContain('Use TypeScript');
      expect(content).toContain('## Corrections');
      expect(content).toContain('Never use var');
      expect(content).toContain('## Failures');
      expect(content).toContain('## DevOps Rules');
    });

    it('returns empty message for no rules', async () => {
      const response = await handler.handlePromptsGet(makeRequest('load-rules'));

      const content = response.result.messages[0].content.text;
      expect(content).toContain('No active rules found');
    });

    it('returns spec-conformant user role message', async () => {
      const response = await handler.handlePromptsGet(makeRequest('load-rules'));

      expect(response.result.messages[0].role).toBe('user');
      expect(response.result.messages[0].content.type).toBe('text');
    });

    it('filters by topic when provided', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [
          { key: 'p1', value: { content: 'Use TypeScript strict' } },
          { key: 'p2', value: { content: 'Prefer tabs' } },
        ],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      const response = await handler.handlePromptsGet(makeRequest('load-rules', { topic: 'typescript' }));

      const content = response.result.messages[0].content.text;
      expect(content).toContain('TypeScript');
      expect(content).not.toContain('tabs');
    });
  });

  describe('unknown prompt', () => {
    it('returns error for unknown prompt name', async () => {
      const response = await handler.handlePromptsGet(makeRequest('nonexistent-prompt'));

      expect(response.error).toBeDefined();
      expect(response.error!.message).toContain('Unknown prompt');
    });
  });
});
