import { describe, expect, it } from 'vitest';
import {
	MAX_LABEL_RUNES,
	bookmarkAt,
	bookmarkName,
	bookmarkedParagraphs,
	snippetAt,
	sortForPanel,
	type Bookmark
} from './bookmarks';

function mark(id: number, position: string, extra: Partial<Bookmark> = {}): Bookmark {
	return { id, bookId: 1, position, label: `b${id}`, createdAt: '2026-11-13T10:00:00Z', ...extra };
}

const runes = (s: string) => Array.from(s).length;

describe('snippetAt', () => {
	it('keeps a short text as it is', () => {
		expect(snippetAt('吾輩は猫である。')).toBe('吾輩は猫である。');
	});

	it('collapses whitespace runs (newlines, tabs, ideographic space) and trims', () => {
		expect(snippetAt('  one\n\ttwo 　 three  ')).toBe('one two three');
	});

	it('drops control and bidi override characters like the server does', () => {
		expect(snippetAt('a\u0007b‮c⁦d')).toBe('abcd');
	});

	it('cuts at 120 code points with an ellipsis that counts toward the limit', () => {
		const text = '漢'.repeat(200);
		const out = snippetAt(text);
		expect(MAX_LABEL_RUNES).toBe(120);
		expect(runes(out)).toBe(120);
		expect(out.endsWith('…')).toBe(true);
		expect(out.startsWith('漢'.repeat(119))).toBe(true);
	});

	it('does not add an ellipsis at exactly the limit', () => {
		const text = 'あ'.repeat(120);
		expect(snippetAt(text)).toBe(text);
	});

	it('counts astral characters as one and never splits a surrogate pair', () => {
		const text = '𠮷'.repeat(130);
		const out = snippetAt(text);
		expect(runes(out)).toBe(120);
		expect(out).toBe('𠮷'.repeat(119) + '…');
		expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
	});

	it('never splits a grapheme cluster (emoji ZWJ sequence)', () => {
		const tech = '👩‍💻'; // 3 code points
		const text = 'x'.repeat(117) + tech + 'y'.repeat(10);
		const out = snippetAt(text);
		expect(out).toBe('x'.repeat(117) + '…');
		expect(runes(out)).toBeLessThanOrEqual(120);
	});

	it('does not leave whitespace before the ellipsis', () => {
		const text = 'a'.repeat(118) + ' ' + 'b'.repeat(20);
		expect(snippetAt(text)).toBe('a'.repeat(118) + '…');
	});

	it('honours a custom limit', () => {
		expect(snippetAt('abcdefgh', 5)).toBe('abcd…');
		expect(snippetAt('abcde', 5)).toBe('abcde');
	});

	it('returns an empty string for blank text', () => {
		expect(snippetAt(' \n\t ')).toBe('');
	});
});

describe('bookmarkAt', () => {
	const list = [mark(1, '0:3'), mark(2, '2:10')];

	it('finds the bookmark at the identical position', () => {
		expect(bookmarkAt(list, '2:10')?.id).toBe(2);
	});

	it('compares parsed positions, not spellings', () => {
		expect(bookmarkAt(list, '02:010')?.id).toBe(2);
	});

	it('is null for another paragraph or chapter', () => {
		expect(bookmarkAt(list, '2:11')).toBeNull();
		expect(bookmarkAt(list, '1:3')).toBeNull();
		expect(bookmarkAt([], '0:0')).toBeNull();
	});

	it('matches a malformed stored position only by the exact string', () => {
		const odd = [mark(5, 'weird')];
		expect(bookmarkAt(odd, 'weird')?.id).toBe(5);
		expect(bookmarkAt(odd, '0:0')).toBeNull();
	});
});

describe('sortForPanel', () => {
	it('orders by chapter, then paragraph, then creation', () => {
		const list = [
			mark(1, '2:0'),
			mark(2, '0:10'),
			mark(3, '0:2'),
			mark(4, '10:1'),
			mark(5, '0:2', { createdAt: '2026-11-12T00:00:00Z' })
		];
		expect(sortForPanel(list).map((b) => b.id)).toEqual([5, 3, 2, 1, 4]);
	});

	it('puts malformed positions last and does not mutate the input', () => {
		const list = [mark(1, 'x'), mark(2, '1:1'), mark(3, '0:0')];
		const copy = [...list];
		expect(sortForPanel(list).map((b) => b.id)).toEqual([3, 2, 1]);
		expect(list).toEqual(copy);
	});
});

describe('bookmarkName', () => {
	it('is the label, else an untitled name with the chapter', () => {
		expect(bookmarkName(mark(1, '2:3', { label: '猫' }))).toBe('猫');
		expect(bookmarkName(mark(1, '2:3', { label: '' }))).toBe('Untitled bookmark in chapter 3');
		expect(bookmarkName(mark(1, 'bad', { label: '' }))).toBe('Untitled bookmark');
	});
});

describe('bookmarkedParagraphs', () => {
	it('lists the paragraphs of one chapter that carry a bookmark', () => {
		const list = [mark(1, '0:3'), mark(2, '1:4'), mark(3, '1:0'), mark(4, 'bad')];
		expect([...bookmarkedParagraphs(list, 1)].sort()).toEqual([0, 4]);
		expect(bookmarkedParagraphs(list, 5).size).toBe(0);
	});
});
