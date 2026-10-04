import {
	CITATION_MATCH_THRESHOLD,
	citationContainment,
	extractCitations,
	extractRuleContent,
	matchCitations,
} from '../../src/shared/citations';

/**
 * `cite_count` is the only record of a rule being *used* rather than loaded,
 * and demotion, the compliance report and the janitor all read it.
 */
describe('citation scanning', () => {
	describe('extractCitations', () => {
		it('pulls every citation out of one message', () => {
			const text = [
				'Rebuilt the bundle (applied from memory: always rebuild before testing).',
				'Then ran the suite (applied from memory: self-verify before done).',
			].join('\n');

			expect(extractCitations(text)).toEqual([
				'always rebuild before testing',
				'self-verify before done',
			]);
		});

		it('ignores the directive placeholders, which are not citations', () => {
			const directive =
				'cite each memory: (applied from memory: <short summary>) or (applied from memory: <short rule name>)';

			expect(extractCitations(directive)).toEqual([]);
		});

		it('is not left stateful by a previous scan', () => {
			const text = 'done (applied from memory: keep the store bounded)';

			expect(extractCitations(text)).toHaveLength(1);
			expect(extractCitations(text)).toHaveLength(1);
		});

		it('returns nothing for empty or uncited text', () => {
			expect(extractCitations('')).toEqual([]);
			expect(extractCitations('plain answer with no marks')).toEqual([]);
		});
	});

	describe('citationContainment', () => {
		it('scores a paraphrase of a long rule by the citation’s own tokens', () => {
			const rule = 'Always run the full verification suite yourself before reporting done.';

			expect(citationContainment('verification suite before done', rule)).toBe(1);
			expect(citationContainment('something entirely different', rule)).toBe(0);
		});

		it('is case- and punctuation-insensitive', () => {
			expect(citationContainment('Self-Verify, before done!', 'self verify before done')).toBe(1);
		});
	});

	describe('extractRuleContent', () => {
		it.each([
			['plain string', 'use tabs', 'use tabs'],
			['JSON with content', JSON.stringify({ content: 'use tabs' }), 'use tabs'],
			['JSON with value', JSON.stringify({ value: 'use tabs' }), 'use tabs'],
			['object with content', { content: 'use tabs' }, 'use tabs'],
		])('reads %s', (_label, value, expected) => {
			expect(extractRuleContent(value)).toBe(expected);
		});
	});

	describe('matchCitations', () => {
		const rules = [
			{ key: 'r-verify', value: JSON.stringify({ content: 'self-verify before done: run the full suite' }) },
			{ key: 'r-tabs', value: JSON.stringify({ content: 'indent with tabs, never spaces' }) },
		];

		it('credits the rule the citation names', () => {
			const matches = matchCitations(['self-verify before done'], rules);

			expect(matches).toHaveLength(1);
			expect(matches[0].key).toBe('r-verify');
			expect(matches[0].containment).toBeGreaterThanOrEqual(CITATION_MATCH_THRESHOLD);
		});

		it('credits exactly one rule per citation, not every rule sharing a word', () => {
			const matches = matchCitations(['indent with tabs instead of spaces'], rules);

			expect(matches.map(m => m.key)).toEqual(['r-tabs']);
		});

		it('demands a complete match from a citation too short to identify much', () => {
			// 'self' and 'verify' both appear in r-verify, so this one is honest…
			expect(matchCitations(['self verify'], rules).map(m => m.key)).toEqual(['r-verify']);
			// …while a partial hit at that length is indistinguishable from chance.
			expect(matchCitations(['verify deployment'], rules)).toEqual([]);
		});

		it('credits nobody when two rules match equally well', () => {
			const twins = [
				{ key: 'r-a', value: 'rebuild the bundle before running the suite' },
				{ key: 'r-b', value: 'rebuild the bundle before running the suite' },
			];

			expect(matchCitations(['rebuild the bundle before running the suite'], twins)).toEqual([]);
		});

		it('ignores a citation made only of everyday words', () => {
			expect(matchCitations(['do it before you are done'], rules)).toEqual([]);
		});

		it('credits nobody when the citation matches nothing well enough', () => {
			expect(matchCitations(['deploy the staging cluster tonight'], rules)).toEqual([]);
		});

		it('handles an empty rule set without crediting anything', () => {
			expect(matchCitations(['self-verify before done'], [])).toEqual([]);
		});
	});
});
