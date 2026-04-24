/**
 * Tests for the rule retrieval / ranking core used by just-in-time rule injection.
 *
 * The retrieval function takes a tool call (name + input) and a list of active
 * rules, and returns the top N rules that are most relevant to THIS specific
 * tool call. This is the core meter that replaces the broken citation regex —
 * we no longer try to detect "(applied from memory:)" markers; instead we
 * measure "was the relevant rule present at the moment of action."
 *
 * The function is intentionally pure: caller passes in the rules. This makes
 * it dead-easy to test without mocking SQLite. The DB-fetching wrapper lives
 * separately in RuleRetrievalService.
 *
 * Ranking ingredients (combined into a single score):
 *   1. Token overlap between the tool call's identifier text and the rule text
 *   2. Sticky flag boost (sticky rules always bubble to the top)
 *   3. Type priority: corrections > devops > preferences > failures
 *   4. Recency boost: rules updated in the last 7 days get a small lift
 *
 * Filter: only rules with score >= MIN_SCORE are returned. This prevents
 * spamming the agent with irrelevant rules on every tool call.
 *
 * Quality: returns at most TOP_N rules (3) so the additionalContext payload
 * stays small enough that the agent can actually attend to all of them.
 */

import { rankRulesForToolCall, buildToolCallQuery, Rule } from '../../src/services/rule-retrieval';

function rule(overrides: Partial<Rule> & { key: string; type: string; value: any }): Rule {
  return {
    is_active: true,
    timestamp: Date.now(),
    project_id: 'test-project',
    ...overrides,
  } as Rule;
}

describe('buildToolCallQuery', () => {
  it('extracts command tokens from a Bash call', () => {
    const tokens = buildToolCallQuery('Bash', { command: 'npm run build && npm test' });
    expect(tokens).toContain('npm');
    expect(tokens).toContain('build');
    expect(tokens).toContain('test');
  });

  it('extracts file path tokens from an Edit call', () => {
    const tokens = buildToolCallQuery('Edit', {
      file_path: '/home/user/project/src/components/Button.tsx',
      old_string: 'const Button',
      new_string: 'export const Button',
    });
    expect(tokens).toContain('button');
    expect(tokens).toContain('components');
    expect(tokens).toContain('edit');
  });

  it('extracts pattern tokens from a Grep call', () => {
    const tokens = buildToolCallQuery('Grep', { pattern: 'TODO|FIXME', path: 'src' });
    expect(tokens).toContain('todo');
    expect(tokens).toContain('grep');
  });

  it('always includes the lowercased tool name', () => {
    expect(buildToolCallQuery('Bash', {})).toContain('bash');
    expect(buildToolCallQuery('WebFetch', {})).toContain('webfetch');
  });

  it('filters out short tokens and stop words', () => {
    const tokens = buildToolCallQuery('Bash', { command: 'cd /tmp && ls' });
    expect(tokens).not.toContain('cd');  // 2 chars
    expect(tokens).not.toContain('&&');
    expect(tokens).not.toContain('the');  // stop word (if it appeared)
  });

  it('handles missing or empty tool_input gracefully', () => {
    const tokens = buildToolCallQuery('Bash', {});
    expect(tokens).toContain('bash');
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('handles null tool_input', () => {
    expect(() => buildToolCallQuery('Bash', null)).not.toThrow();
  });
});

describe('rankRulesForToolCall — token overlap', () => {
  it('matches a rule whose text overlaps with the tool call', () => {
    const rules: Rule[] = [
      rule({ key: 'r1', type: 'devops', value: { content: 'Run npm run build before npm test' } }),
      rule({ key: 'r2', type: 'preference', value: { content: 'Use tabs for indentation' } }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'npm run build && npm test' }, rules);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.key).toBe('r1'); // r1 has many overlapping tokens
  });

  it('returns empty when no rule meets the threshold', () => {
    const rules: Rule[] = [
      rule({ key: 'r1', type: 'preference', value: { content: 'Use Spanish for variable names' } }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'docker compose up' }, rules);

    // No tokens overlap → score below threshold → no matches
    expect(matches).toEqual([]);
  });

  it('returns at most 3 rules even when many match', () => {
    const rules: Rule[] = [];
    for (let i = 0; i < 10; i++) {
      rules.push(rule({
        key: `r${i}`,
        type: 'devops',
        value: { content: `Use npm command for build step ${i}` },
      }));
    }

    const matches = rankRulesForToolCall('Bash', { command: 'npm run build' }, rules);
    expect(matches.length).toBeLessThanOrEqual(3);
  });

  it('ranks rules by score descending', () => {
    const rules: Rule[] = [
      rule({ key: 'low', type: 'preference', value: { content: 'use npm sometimes' } }),
      rule({ key: 'high', type: 'devops', value: { content: 'always run npm run build before npm test in CI' } }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'npm run build && npm test' }, rules);

    expect(matches.length).toBe(2);
    expect(matches[0].rule.key).toBe('high');
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });
});

describe('rankRulesForToolCall — sticky flag', () => {
  it('always returns sticky rules even with low token overlap', () => {
    const rules: Rule[] = [
      rule({
        key: 'sticky-rule',
        type: 'correction',
        value: { content: 'Never run rm -rf without --force confirmation', sticky: true },
      }),
      rule({ key: 'normal', type: 'devops', value: { content: 'unrelated rule' } }),
    ];

    // Even though "ls" doesn't overlap with the sticky rule's tokens, it should still appear
    const matches = rankRulesForToolCall('Bash', { command: 'ls /tmp' }, rules);

    const stickyMatch = matches.find(m => m.rule.key === 'sticky-rule');
    expect(stickyMatch).toBeDefined();
  });

  it('sticky rules rank above non-sticky rules with similar token overlap', () => {
    const rules: Rule[] = [
      rule({
        key: 'sticky',
        type: 'preference',
        value: { content: 'always use npm not yarn', sticky: true },
      }),
      rule({
        key: 'normal',
        type: 'preference',
        value: { content: 'always use npm not yarn for consistency' },
      }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'npm install' }, rules);

    expect(matches[0].rule.key).toBe('sticky');
  });
});

describe('rankRulesForToolCall — type priority', () => {
  it('boosts corrections above preferences with the same token overlap', () => {
    const rules: Rule[] = [
      rule({ key: 'pref', type: 'preference', value: { content: 'use tabs in this project' } }),
      rule({ key: 'corr', type: 'correction', value: { content: 'use tabs in this project' } }),
    ];

    const matches = rankRulesForToolCall('Edit', { file_path: '/tmp/x.ts', old_string: 'tabs project' }, rules);

    expect(matches[0].rule.key).toBe('corr');
  });
});

describe('rankRulesForToolCall — failure exclusion (raw failures are noise)', () => {
  it('excludes raw failure entries entirely from JIT injection', () => {
    const rules: Rule[] = [
      // Generic auto-captured failure noise — should NOT surface in JIT
      rule({
        key: 'hook_failure_xyz',
        type: 'failure',
        value: { title: 'Avoid: Test command reported failures: npm test', content: { what_failed: 'npm test failed' } },
      }),
      rule({
        key: 'hook_failure_abc',
        type: 'failure',
        value: { content: 'npm test 2>&1 | tail failed' },
      }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'npm test' }, rules);

    // No raw failures should appear in the matches
    expect(matches.find(m => m.rule.type === 'failure')).toBeUndefined();
    expect(matches).toEqual([]);
  });

  it('INCLUDES promoted lessons (failures graduated by the promotion engine)', () => {
    const rules: Rule[] = [
      rule({
        key: 'promoted_1234_abc',
        type: 'failure',
        value: {
          content: 'always run pre-flight checks before mycli onboard',
          source: 'promotion-engine',
          evidence_count: 3,
        },
      }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'mycli onboard --from blueprint' }, rules);

    expect(matches.length).toBe(1);
    expect(matches[0].rule.key).toBe('promoted_1234_abc');
  });

  it('detects promoted lesson via value.source field even without promoted_ key prefix', () => {
    const rules: Rule[] = [
      rule({
        key: 'somekey',
        type: 'failure',
        value: { content: 'always pipe y to mycli upgrade prompt', source: 'promotion-engine' },
      }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'mycli upgrade' }, rules);

    expect(matches.length).toBe(1);
    expect(matches[0].rule.key).toBe('somekey');
  });

  it('still surfaces actionable rules (devops/correction/preference) when failures are present', () => {
    const rules: Rule[] = [
      rule({ key: 'fail', type: 'failure', value: { content: 'npm test failed' } }),
      rule({ key: 'devops', type: 'devops', value: { content: 'always run npm test from project root' } }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'npm test' }, rules);

    expect(matches.length).toBe(1);
    expect(matches[0].rule.key).toBe('devops');
  });
});

describe('rankRulesForToolCall — input handling', () => {
  it('handles empty rules list', () => {
    expect(rankRulesForToolCall('Bash', { command: 'ls' }, [])).toEqual([]);
  });

  it('handles null tool_input gracefully', () => {
    const rules: Rule[] = [
      rule({ key: 'r1', type: 'devops', value: { content: 'Run bash carefully' } }),
    ];
    expect(() => rankRulesForToolCall('Bash', null, rules)).not.toThrow();
  });

  it('handles rule with non-string value content (nested object)', () => {
    // Use devops type since raw failures are excluded from JIT injection
    const rules: Rule[] = [
      rule({
        key: 'weird',
        type: 'devops',
        value: { content: { instructions: 'always run npm publish from project root', why: 'auth context' } },
      }),
    ];

    // Should still extract tokens from nested content without throwing
    const matches = rankRulesForToolCall('Bash', { command: 'npm publish' }, rules);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].rule.key).toBe('weird');
  });

  it('skips inactive rules', () => {
    const rules: Rule[] = [
      rule({
        key: 'inactive',
        type: 'devops',
        value: { content: 'always run npm test' },
        is_active: false,
      }),
      rule({ key: 'active', type: 'devops', value: { content: 'always run npm test' } }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'npm test' }, rules);

    expect(matches.find(m => m.rule.key === 'inactive')).toBeUndefined();
    expect(matches.find(m => m.rule.key === 'active')).toBeDefined();
  });
});

describe('rankRulesForToolCall — recency', () => {
  it('boosts recently-updated rules over older ones with same overlap', () => {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const rules: Rule[] = [
      rule({
        key: 'old',
        type: 'devops',
        value: { content: 'use npm for builds' },
        timestamp: now - 30 * 24 * 60 * 60 * 1000, // 30 days ago
      }),
      rule({
        key: 'recent',
        type: 'devops',
        value: { content: 'use npm for builds' },
        timestamp: now - 1 * 24 * 60 * 60 * 1000, // 1 day ago
      }),
    ];

    const matches = rankRulesForToolCall('Bash', { command: 'npm install' }, rules);

    expect(matches[0].rule.key).toBe('recent');
  });
});
