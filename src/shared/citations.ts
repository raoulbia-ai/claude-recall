/**
 * Citation scanning — shared by the Claude Code stop hook and the Pi extension.
 *
 * The rule directive asks the model to mark where a memory influenced its work:
 * `(applied from memory: …)`. Those marks are the only evidence of a rule being
 * used rather than loaded, and `cite_count` feeds demotion, the compliance
 * report and the janitor.
 */

/** `(applied from memory: …)` — the format the rule directive asks for. */
const CITATION_PATTERN = /\(applied from memory:\s*(.+?)\)/g;

/** Placeholders from the directive itself — never real citations. */
const PLACEHOLDERS = /^<.*>$/;

/** Default containment above which a citation is considered to name a rule. */
export const CITATION_MATCH_THRESHOLD = 0.5;

/**
 * How far the best match must beat the runner-up. A citation names one rule;
 * when two score alike the citation simply has not identified either of them.
 */
export const CITATION_MARGIN = 0.15;

/** At least this many distinctive tokens, or the citation identifies nothing. */
export const CITATION_MIN_TOKENS = 2;

/**
 * Below this many distinctive tokens a citation must match a rule completely.
 * Containment divides by the citation's own tokens, so a two-word citation
 * scores 1.0 against any long rule that happens to contain both words; demanding
 * everything is the only honest bar at that length.
 */
export const CITATION_SHORT_TOKENS = 4;

/**
 * Words too common to identify anything. Without this, "self-verify before
 * done" scored 0.75 against an unrelated checkpoint on "before" and "done".
 */
const STOPWORDS = new Set([
	'a', 'about', 'after', 'all', 'always', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been',
	'before', 'but', 'by', 'can', 'do', 'does', 'doing', 'done', 'each', 'every', 'first', 'for',
	'from', 'get', 'has', 'have', 'how', 'if', 'in', 'into', 'is', 'it', 'its', 'just', 'make',
	'more', 'must', 'never', 'new', 'no', 'not', 'of', 'on', 'one', 'only', 'or', 'other', 'out',
	'over', 'run', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'then', 'there',
	'these', 'they', 'this', 'to', 'up', 'use', 'used', 'using', 'was', 'were', 'what', 'when',
	'where', 'which', 'while', 'why', 'will', 'with', 'would', 'you', 'your',
]);

export interface CitableRule {
	key: string;
	value: unknown;
}

export interface CitationMatch {
	citation: string;
	key: string;
	containment: number;
}

/** Pull citation texts out of one assistant message. */
export function extractCitations(text: string): string[] {
	if (!text) return [];
	const found: string[] = [];
	// Fresh lastIndex per call: the pattern is module-level and /g is stateful.
	CITATION_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = CITATION_PATTERN.exec(text)) !== null) {
		const cite = match[1].trim();
		if (cite && !PLACEHOLDERS.test(cite)) found.push(cite);
	}
	return found;
}

/**
 * What fraction of the citation's tokens appear in the rule text?
 * Better than Jaccard for short citations matching long rules.
 */
export function citationContainment(citation: string, ruleText: string): number {
	const citeTokens = distinctiveTokens(citation);
	const ruleTokens = tokenize(ruleText);
	if (citeTokens.size === 0) return 0;
	let found = 0;
	for (const w of citeTokens) {
		if (ruleTokens.has(w)) found++;
	}
	return found / citeTokens.size;
}

function tokenize(text: string): Set<string> {
	// Keep non-ASCII letters: rules and citations are not always English.
	return new Set(
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, ' ')
			.split(/\s+/)
			.filter(Boolean),
	);
}

/** Tokens that can actually identify a rule — everyday words cannot. */
export function distinctiveTokens(text: string): Set<string> {
	const tokens = new Set<string>();
	for (const token of tokenize(text)) {
		if (token.length > 2 && !STOPWORDS.has(token)) tokens.add(token);
	}
	return tokens;
}

/** Extract plain text from a rule value (JSON string, object, or plain string). */
export function extractRuleContent(value: unknown): string {
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			if (typeof parsed === 'string') return parsed;
			if (typeof parsed?.content === 'string') return parsed.content;
			if (typeof parsed?.value === 'string') return parsed.value;
			if (parsed?.content) return JSON.stringify(parsed.content);
			return value;
		} catch {
			return value;
		}
	}
	if (typeof value === 'object' && value !== null) {
		const v = value as Record<string, unknown>;
		if (typeof v.content === 'string') return v.content;
		if (typeof v.value === 'string') return v.value;
		return JSON.stringify(value);
	}
	return String(value ?? '');
}

/**
 * Attribute each citation to its best-matching rule: one winner, above the
 * threshold. Crediting every rule sharing a few tokens would just re-count loads.
 */
export function matchCitations(
	citations: readonly string[],
	rules: readonly CitableRule[],
	threshold: number = CITATION_MATCH_THRESHOLD,
): CitationMatch[] {
	const matches: CitationMatch[] = [];

	for (const citation of citations) {
		// Too generic to identify anything — "(applied from memory: be careful)".
		if (distinctiveTokens(citation).size < CITATION_MIN_TOKENS) continue;

		let best: CitationMatch | undefined;
		let runnerUp = 0;
		for (const rule of rules) {
			const containment = citationContainment(citation, extractRuleContent(rule.value));
			if (containment > (best?.containment ?? 0)) {
				runnerUp = best?.containment ?? 0;
				best = { citation, key: rule.key, containment };
			} else if (containment > runnerUp) {
				runnerUp = containment;
			}
		}

		// A citation naming a rule we never stored (CLAUDE.md, a skill) must
		// credit nobody rather than the nearest row.
		const required =
			distinctiveTokens(citation).size < CITATION_SHORT_TOKENS ? 1 : threshold;
		if (!best || best.containment < required) continue;
		if (best.containment - runnerUp < CITATION_MARGIN) continue;

		matches.push(best);
	}

	return matches;
}
