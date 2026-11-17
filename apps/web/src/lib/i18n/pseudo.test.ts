import { describe, expect, it } from 'vitest';
import { formatMessage, messageShape, parseMessage } from './message';
import { pseudoCatalogue, pseudoText } from './pseudo';
import en from './messages/en.json';

// The test-only pseudo-locale en-XA (spec Ruling): every message wrapped and accented, arguments, tags and
// plural structure kept. Generated in tests, never shipped.

describe('pseudoText', () => {
	it('replaces every ASCII letter, keeps everything else', () => {
		const out = pseudoText("Don't save 3 cards!");
		expect(out).not.toMatch(/[A-Za-z]/);
		expect(Array.from(out)).toHaveLength("Don't save 3 cards!".length);
		expect(out).toContain("'");
		expect(out).toContain('3');
	});
});

describe('pseudoCatalogue', () => {
	const sample: Record<string, string> = {
		'test.plain': 'Save changes',
		'test.args': 'Signed in as {name}, {count} left',
		'test.tags': 'Read the <link>notes</link> first',
		'test.plural': '{n, plural, one {# card in {deck}} other {# cards in {deck}}}'
	};
	const pseudo = pseudoCatalogue(sample);

	it('keeps keys, arguments, tags and plural categories; every message parses', () => {
		expect(Object.keys(pseudo)).toEqual(Object.keys(sample));
		for (const [k, m] of Object.entries(sample)) expect(messageShape(parseMessage(pseudo[k]))).toEqual(messageShape(m));
	});

	it('wraps and accents the text so concatenation and leftovers show', () => {
		expect(pseudo['test.plain']).toBe(`⟦${pseudoText('Save changes')}⟧`);
		expect(formatMessage(pseudo['test.args'], 'en', { name: 'ana', count: '2' })).toBe(
			`⟦${pseudoText('Signed in as ')}ana${pseudoText(', ')}2${pseudoText(' left')}⟧`
		);
		expect(formatMessage(pseudo['test.plural'], 'en', { n: 1, deck: 'HSK' })).toBe(`⟦1${pseudoText(' card in ')}HSK⟧`);
		expect(formatMessage(pseudo['test.tags'], 'en', {})).toBe(`⟦${pseudoText('Read the notes first')}⟧`);
	});

	it('covers the whole English catalogue', () => {
		const all = pseudoCatalogue(en);
		for (const [k, m] of Object.entries(en)) {
			expect(messageShape(parseMessage(all[k as keyof typeof en]))).toEqual(messageShape(m));
			if (m !== '') expect(all[k as keyof typeof en]).not.toBe(m);
		}
	});
});
