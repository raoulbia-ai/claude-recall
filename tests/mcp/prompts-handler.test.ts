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
      storage: { searchByContext: mockSearchByContext },
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
    it('returns 7 prompts', async () => {
      const response = await handler.handlePromptsList({
        jsonrpc: '2.0', id: 1, method: 'prompts/list',
      });

      expect(response.result.prompts).toHaveLength(7);
    });

    it('includes load-rules prompt', async () => {
      const response = await handler.handlePromptsList({
        jsonrpc: '2.0', id: 1, method: 'prompts/list',
      });

      const names = response.result.prompts.map((p: any) => p.name);
      expect(names).toContain('load-rules');
      expect(names).toContain('session-review');
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

      const content = response.result.messages[0].content;
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

      const content = response.result.messages[0].content;
      expect(content).toContain('No active rules found');
    });

    it('returns system role message', async () => {
      const response = await handler.handlePromptsGet(makeRequest('load-rules'));

      expect(response.result.messages[0].role).toBe('system');
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

      const content = response.result.messages[0].content;
      expect(content).toContain('TypeScript');
      expect(content).not.toContain('tabs');
    });
  });

  describe('session-review prompt', () => {
    it('returns outcome summary with promoted lessons', async () => {
      mockGetCandidateLessons.mockReturnValue([
        {
          id: '1', project_id: 'test', lesson_text: 'Always check file exists before edit',
          status: 'promoted', evidence_count: 3, confidence: 0.9,
          lesson_kind: 'failure_preventer', outcome_type: 'negative',
        },
      ]);

      const response = await handler.handlePromptsGet(makeRequest('session-review'));

      const content = response.result.messages[0].content;
      expect(content).toContain('# Session Review');
      expect(content).toContain('Promoted Lessons');
      expect(content).toContain('Always check file exists before edit');
      expect(content).toContain('seen 3x');
    });

    it('returns candidate lessons', async () => {
      mockGetCandidateLessons.mockReturnValue([
        {
          id: '1', project_id: 'test', lesson_text: 'Run tests after refactoring',
          status: 'candidate', evidence_count: 1, confidence: 0.75,
          lesson_kind: 'rule', outcome_type: 'negative',
        },
      ]);

      const response = await handler.handlePromptsGet(makeRequest('session-review'));

      const content = response.result.messages[0].content;
      expect(content).toContain('Candidate Lessons');
      expect(content).toContain('Run tests after refactoring');
    });

    it('returns memory summary', async () => {
      mockLoadActiveRules.mockReturnValue({
        preferences: [{ key: 'p1', value: 'x' }],
        corrections: [],
        failures: [],
        devops: [],
        summary: '',
      });

      const response = await handler.handlePromptsGet(makeRequest('session-review'));

      const content = response.result.messages[0].content;
      expect(content).toContain('Memory Summary');
      expect(content).toContain('1 active rules');
    });

    it('handles empty outcome data gracefully', async () => {
      const response = await handler.handlePromptsGet(makeRequest('session-review'));

      const content = response.result.messages[0].content;
      expect(content).toContain('# Session Review');
      expect(content).toContain('Memory Summary');
    });

    it('returns system role message', async () => {
      const response = await handler.handlePromptsGet(makeRequest('session-review'));

      expect(response.result.messages[0].role).toBe('system');
    });
  });

  describe('unknown prompt', () => {
    it('returns error for unknown prompt name', async () => {
      const response = await handler.handlePromptsGet(makeRequest('nonexistent-prompt'));

      expect(response.error).toBeDefined();
      expect(response.error.message).toContain('Unknown prompt');
    });
  });
});
