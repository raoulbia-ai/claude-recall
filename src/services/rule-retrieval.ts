/**
 * Rule retrieval & ranking — the core of just-in-time rule injection (JITRI).
 *
 * This module is the meter that replaces the broken citation-detection regex.
 * Instead of trying to detect "(applied from memory: ...)" markers in agent
 * output (which empirically doesn't work — see .research/rule-loading-gap.md),
 * we measure "was the relevant rule present at the moment of action" by
 * injecting matched rules into the agent's context immediately adjacent to
 * each tool call via a PreToolUse hook.
 *
 * This file is intentionally pure — it takes pre-fetched rules as input and
 * has no DB access. The DB-fetching wrapper lives in RuleRetrievalService.
 * Keeping the ranking pure makes it dead-simple to test and lets the same
 * function serve both the CC PreToolUse hook path and the Pi
 * `before_agent_start` path.
 *
 * Ranking ingredients:
 *   1. Token overlap (Jaccard between query tokens and rule tokens) — main signal
 *   2. Sticky boost (+0.5) — sticky rules always bubble to the top
 *   3. Type priority — corrections > devops > preferences > failures
 *   4. Recency boost — rules updated within 7 days get a small lift
 *
 * Filter: only rules with combined score >= MIN_SCORE are returned. Caps at
 * TOP_N (3) so the additionalContext payload stays small enough to fit
 * comfortably in the agent's attention budget.
 */

export interface Rule {
  key: string;
  type: string;
  value: any;
  is_active?: boolean;
  timestamp?: number;
  project_id?: string;
}

export interface RankedRule {
  rule: Rule;
  score: number;
  matchedTokens: string[];
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'could', 'may', 'might', 'must', 'shall', 'can', 'this', 'that', 'these', 'those',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'them', 'their', 'what', 'which',
  'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
  'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'as', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'by', 'from', 'up', 'down', 'into', 'over', 'under',
]);

const MIN_TOKEN_LENGTH = 3;
const MIN_SCORE = 0.15;
const TOP_N = 3;
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STICKY_BOOST = 0.5;
const RECENCY_BOOST = 0.1;

// Type boosts: corrections and devops are ACTIONABLE rules — boost them.
// Failures are auto-captured post-hoc records that tend to accumulate as
// noise (every "test failed" attempt becomes a memory). Deboost so generic
// failure entries need substantial token overlap to surface; real anti-patterns
// with high overlap still come through. See .research/rule-loading-gap.md.
const TYPE_BOOSTS: Record<string, number> = {
  correction: 0.25,
  devops: 0.20,
  preference: 0.10,
  'project-knowledge': 0.05,
  failure: -0.10,
};

/**
 * Tokenize a string: lowercase, keep alphanumeric only, drop short tokens
 * and stop words.
 */
function tokenize(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= MIN_TOKEN_LENGTH && !STOP_WORDS.has(t));
}

/**
 * Build the query tokens from a tool call. Includes the tool name plus
 * relevant fields from tool_input depending on the tool type.
 *
 * For Bash:  command
 * For Edit:  file_path + old_string (truncated)
 * For Write: file_path + content (truncated)
 * For Read/Glob: file_path + pattern
 * For Grep:  pattern + path
 * For Task:  description + prompt
 * For others: best-effort stringification of all string-valued fields
 */
export function buildToolCallQuery(toolName: string, toolInput: any): string[] {
  const parts: string[] = [toolName];

  if (toolInput && typeof toolInput === 'object') {
    const stringFields = ['command', 'file_path', 'pattern', 'path', 'description', 'prompt', 'query', 'url'];
    for (const field of stringFields) {
      const v = toolInput[field];
      if (typeof v === 'string') parts.push(v);
    }
    // Truncated diff fields — keep them but cap length
    if (typeof toolInput.old_string === 'string') {
      parts.push(toolInput.old_string.substring(0, 200));
    }
    if (typeof toolInput.new_string === 'string') {
      parts.push(toolInput.new_string.substring(0, 200));
    }
    if (typeof toolInput.content === 'string') {
      parts.push(toolInput.content.substring(0, 200));
    }
  }

  return tokenize(parts.join(' '));
}

/**
 * Recursively extract leaf string values from a value object — used to build
 * the rule's token vocabulary. Skips JSON structure tokens (keys, brackets).
 */
function extractRuleText(value: any): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(extractRuleText).join(' ');
  }
  if (typeof value === 'object') {
    // Prefer common content fields first
    if (typeof value.content === 'string') return value.content;
    if (typeof value.value === 'string') return value.value;
    // Recurse into all string-leaf fields, including nested
    const parts: string[] = [];
    for (const v of Object.values(value)) {
      const text = extractRuleText(v);
      if (text) parts.push(text);
    }
    return parts.join(' ');
  }
  return '';
}

/**
 * Check if a rule has the sticky flag set (in value.sticky or top-level).
 */
function isSticky(rule: Rule): boolean {
  if (rule.value && typeof rule.value === 'object' && rule.value.sticky === true) return true;
  return false;
}

/**
 * Compute Jaccard-like overlap: |intersection| / |query|.
 * Asymmetric: we care what fraction of the QUERY tokens appear in the rule,
 * not the other way around. A long rule that contains all query tokens scores
 * higher than a short rule that contains some query tokens — which matches
 * intuition (specific rules win).
 */
function tokenOverlap(queryTokens: string[], ruleTokens: Set<string>): { score: number; matched: string[] } {
  if (queryTokens.length === 0) return { score: 0, matched: [] };
  const matched: string[] = [];
  for (const t of queryTokens) {
    if (ruleTokens.has(t)) matched.push(t);
  }
  return { score: matched.length / queryTokens.length, matched };
}

/**
 * A "promoted lesson" is a failure-type memory that the promotion engine has
 * graduated into an actionable rule. Detected by key prefix or value.source.
 * These ARE worth surfacing in JIT injection (unlike raw failure logs which
 * are just noise from the auto-capture pipeline).
 */
function isPromotedLesson(rule: Rule): boolean {
  if (rule.key && rule.key.startsWith('promoted_')) return true;
  if (rule.value && typeof rule.value === 'object' && rule.value.source === 'promotion-engine') return true;
  return false;
}

/**
 * Rank a list of rules against a tool call. Returns the top N (default 3)
 * with score >= MIN_SCORE, sorted by descending score.
 *
 * Sticky rules always pass the threshold (their boost guarantees it).
 *
 * Raw failures are EXCLUDED from JIT injection — they're reference material,
 * not actionable rules at the moment of decision. The auto-capture pipeline
 * generates many low-value failure entries ("Avoid: Test command reported
 * failures: npm test ...") that share tokens with common dev commands but
 * aren't useful as decision-time guidance. The actionable equivalents are
 * (a) promoted lessons (failures graduated by the promotion engine — these
 * ARE included), (b) corrections, and (c) devops rules. See
 * .research/rule-loading-gap.md for the full reasoning.
 */
export function rankRulesForToolCall(
  toolName: string,
  toolInput: any,
  rules: Rule[],
): RankedRule[] {
  const queryTokens = buildToolCallQuery(toolName, toolInput);
  if (queryTokens.length === 0) return [];

  const ranked: RankedRule[] = [];

  for (const rule of rules) {
    if (rule.is_active === false) continue;

    // Exclude raw failures from JIT injection. Promoted lessons survive
    // because they've been graduated into actionable rules.
    if (rule.type === 'failure' && !isPromotedLesson(rule)) continue;

    const ruleText = extractRuleText(rule.value);
    if (!ruleText) continue;

    const ruleTokens = new Set(tokenize(ruleText));
    const { score: overlapScore, matched } = tokenOverlap(queryTokens, ruleTokens);

    let totalScore = overlapScore;

    if (isSticky(rule)) totalScore += STICKY_BOOST;

    const typeBoost = TYPE_BOOSTS[rule.type] ?? 0;
    totalScore += typeBoost * (overlapScore > 0 ? 1 : 0); // Only apply type boost if there's some overlap

    if (rule.timestamp && Date.now() - rule.timestamp < RECENT_WINDOW_MS) {
      totalScore += RECENCY_BOOST * (overlapScore > 0 ? 1 : 0);
    }

    if (totalScore >= MIN_SCORE) {
      ranked.push({ rule, score: totalScore, matchedTokens: matched });
    }
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, TOP_N);
}
