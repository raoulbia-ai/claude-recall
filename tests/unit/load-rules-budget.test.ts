/**
 * Unit tests for load_rules token budget and priority ordering.
 *
 * These tests exercise the MCP tool handler end-to-end via MemoryTools and verify:
 *   - Payload respects CLAUDE_RECALL_LOAD_BUDGET_TOKENS.
 *   - Rules with higher cite_count survive truncation.
 *   - Truncation marker appears when rules are dropped.
 *   - Rule Health diagnostic is no longer in the payload.
 */

import { MemoryStorage } from '../../src/memory/storage';
import { MemoryService } from '../../src/services/memory';
import { LoggingService } from '../../src/services/logging';
import { MemoryTools } from '../../src/mcp/tools/memory-tools';
import { MCPContext } from '../../src/mcp/server';

describe('load_rules token budget', () => {
  let storage: MemoryStorage;
  let previousBudget: string | undefined;

  beforeAll(() => {
    previousBudget = process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS;
  });

  afterAll(() => {
    if (previousBudget === undefined) {
      delete process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS;
    } else {
      process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS = previousBudget;
    }
  });

  beforeEach(() => {
    const service = MemoryService.getInstance();
    storage = service['storage'] as MemoryStorage;
    // Clean slate so each test sees only its own fixtures.
    storage.getDatabase().prepare('DELETE FROM memories').run();
  });

  function insertDevopsRule(params: {
    key: string; content: string; cite_count?: number; timestamp?: number;
  }): void {
    storage.getDatabase().prepare(`
      INSERT INTO memories (key, value, type, timestamp, is_active, cite_count, load_count)
      VALUES (?, ?, 'devops', ?, 1, ?, 0)
    `).run(
      params.key,
      JSON.stringify({ content: params.content }),
      params.timestamp ?? Date.now(),
      params.cite_count ?? 0,
    );
  }

  async function callLoadRules(): Promise<any> {
    const service = MemoryService.getInstance();
    const logger = LoggingService.getInstance();
    const tools = new MemoryTools(service, logger);
    const handler = tools.getTools()
      .find(t => t.name === 'mcp__claude-recall__load_rules');
    expect(handler).toBeDefined();
    const ctx = { sessionId: 'test-session', projectId: undefined } as unknown as MCPContext;
    return await handler!.handler({}, ctx);
  }

  it('payload shrinks when budget is tight', async () => {
    // Insert 20 devops rules with roughly 200 chars each (~50 tokens each).
    for (let i = 0; i < 20; i++) {
      insertDevopsRule({
        key: `budget-rule-${i}`,
        content: `Rule number ${i}: ` + 'a very long explanation of a devops convention that goes on for quite a while so token estimation has something meaningful to measure '.repeat(2),
      });
    }

    process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS = '100';
    const tight = await callLoadRules();

    process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS = '100000';
    const loose = await callLoadRules();

    expect(tight.counts.devops).toBeLessThan(loose.counts.devops);
    expect(tight.counts.dropped).toBeGreaterThan(0);
    expect(loose.counts.dropped).toBe(0);
  });

  it('high-cite rules survive truncation over uncited ones', async () => {
    const base = Date.now();
    // Each ~160 chars → ~40 tokens. Budget of 60 tokens fits exactly one rule,
    // forcing the sort-by-cite selection to matter.
    insertDevopsRule({ key: 'uncited-old', content: 'uncited old rule: ' + 'text '.repeat(30), cite_count: 0, timestamp: base - 10_000 });
    insertDevopsRule({ key: 'cited-high', content: 'cited high rule: ' + 'text '.repeat(30), cite_count: 50, timestamp: base - 20_000 });
    insertDevopsRule({ key: 'uncited-new', content: 'uncited new rule: ' + 'text '.repeat(30), cite_count: 0, timestamp: base });

    process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS = '60';
    const result = await callLoadRules();

    // cited-high must beat the uncited ones
    expect(result.rules).toContain('cited high rule');
    expect(result.rules).not.toContain('uncited old rule');
    expect(result.rules).not.toContain('uncited new rule');
    expect(result.counts.dropped).toBe(2);
  });

  it('appends truncation marker when dropped > 0', async () => {
    for (let i = 0; i < 10; i++) {
      insertDevopsRule({
        key: `marker-rule-${i}`,
        content: `rule ${i} content with enough text to consume meaningful tokens for the budget test`,
      });
    }

    process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS = '50';
    const result = await callLoadRules();

    expect(result.counts.dropped).toBeGreaterThan(0);
    expect(result.rules).toMatch(/more rules available via.*search_memory/);
  });

  it('omits truncation marker when nothing is dropped', async () => {
    insertDevopsRule({ key: 'only-rule', content: 'single benign rule' });

    process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS = '100000';
    const result = await callLoadRules();

    expect(result.counts.dropped).toBe(0);
    expect(result.rules).not.toMatch(/more rules available via/);
  });

  it('no longer renders a Rule Health section in the payload', async () => {
    // Create a rule with load_count >= 5 and cite_count = 0 — would previously
    // trigger the Rule Health diagnostic block. Now it should be absent.
    storage.getDatabase().prepare(`
      INSERT INTO memories (key, value, type, timestamp, is_active, cite_count, load_count)
      VALUES ('stale-rule', ?, 'devops', ?, 1, 0, 10)
    `).run(JSON.stringify({ content: 'some long-loaded uncited rule content for health detection' }), Date.now());

    process.env.CLAUDE_RECALL_LOAD_BUDGET_TOKENS = '100000';
    const result = await callLoadRules();

    expect(result.rules).not.toMatch(/## Rule Health/);
  });
});
