import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../docs/contracts/reader/furigana-align.json';
import { alignFurigana } from './furigana';

describe('alignFurigana (contract)', () => {
	expect(fixture.version).toBe(1);
	for (const c of fixture.cases) {
		it(c.name, () => {
			const got = alignFurigana(c.surface, c.lemma, c.reading);
			const want = c.expect === null ? null : c.expect.map(([text, rt]) => (rt === null ? { text } : { text, rt }));
			expect(got).toEqual(want);
		});
	}
	it('pieces always concatenate to the surface', () => {
		for (const c of fixture.cases) {
			const got = alignFurigana(c.surface, c.lemma, c.reading);
			if (got) expect(got.map((p) => p.text).join('')).toBe(c.surface);
		}
	});
});
