import { describe, expect, it } from 'vitest';
import { codePointToUtf16, hoverable, selectionTarget, utf16ToCodePoint } from './lookup';

describe('utf16ToCodePoint / codePointToUtf16', () => {
	it('counts a surrogate pair as one code point', () => {
		expect(utf16ToCodePoint('a𠮷b', 0)).toBe(0);
		expect(utf16ToCodePoint('a𠮷b', 1)).toBe(1);
		expect(utf16ToCodePoint('a𠮷b', 3)).toBe(2);
		expect(utf16ToCodePoint('a𠮷b', 4)).toBe(3);
		expect(codePointToUtf16('a𠮷b', 2)).toBe(3);
		expect(codePointToUtf16('a𠮷b', 3)).toBe(4);
		expect(codePointToUtf16('a𠮷b', 1)).toBe(1);
	});

	it('maps an index inside a surrogate pair to that code point', () => {
		expect(utf16ToCodePoint('a𠮷b', 2)).toBe(1);
	});

	it('clamps out-of-range indexes to the text bounds', () => {
		expect(utf16ToCodePoint('a𠮷b', 99)).toBe(3);
		expect(utf16ToCodePoint('a𠮷b', -1)).toBe(0);
		expect(codePointToUtf16('a𠮷b', 99)).toBe(4);
		expect(codePointToUtf16('a𠮷b', -1)).toBe(0);
	});

	it('counts a lone surrogate as one code point, like Array.from', () => {
		const loneHigh = 'a\uD800b';
		expect(Array.from(loneHigh)).toHaveLength(3);
		expect(utf16ToCodePoint(loneHigh, 1)).toBe(1);
		expect(utf16ToCodePoint(loneHigh, 2)).toBe(2);
		expect(utf16ToCodePoint(loneHigh, 3)).toBe(3);
		expect(codePointToUtf16(loneHigh, 2)).toBe(2);
		expect(codePointToUtf16(loneHigh, 3)).toBe(3);
		const loneLow = 'a\uDC00b';
		expect(utf16ToCodePoint(loneLow, 2)).toBe(2);
		expect(utf16ToCodePoint(loneLow, 3)).toBe(3);
		expect(codePointToUtf16(loneLow, 2)).toBe(2);
		// A high surrogate at the very end is alone too.
		expect(utf16ToCodePoint('a\uD800', 2)).toBe(2);
		expect(codePointToUtf16('a\uD800', 2)).toBe(2);
	});

	it('round-trips every code point boundary', () => {
		const text = '𠮷野家で食べた';
		for (let cp = 0; cp <= Array.from(text).length; cp++) {
			expect(utf16ToCodePoint(text, codePointToUtf16(text, cp))).toBe(cp);
		}
	});
});

describe('selectionTarget', () => {
	it('trims and maps one code point to a character', () => {
		expect(selectionTarget('  学 ')).toEqual({ text: '学', kind: 'character' });
		expect(selectionTarget('𠮷')).toEqual({ text: '𠮷', kind: 'character' });
	});

	it('maps several code points to a word', () => {
		expect(selectionTarget('学习')).toEqual({ text: '学习', kind: 'word' });
		expect(selectionTarget('\n食べた\t')).toEqual({ text: '食べた', kind: 'word' });
	});

	it('returns null for empty, whitespace or punctuation-only selections', () => {
		expect(selectionTarget('')).toBeNull();
		expect(selectionTarget('   ')).toBeNull();
		expect(selectionTarget('。 ')).toBeNull();
		expect(selectionTarget('「」、！')).toBeNull();
		expect(selectionTarget('　')).toBeNull();
	});
});

describe('hoverable', () => {
	it('accepts CJK characters and kana', () => {
		for (const ch of ['学', '學', 'す', 'ス', 'ー', '𠮷']) expect(hoverable(ch)).toBe(true);
	});

	it('rejects Latin letters, digits, punctuation and whitespace', () => {
		for (const ch of ['a', 'Z', 'é', 'ａ', '7', '７', '½', '。', '，', ' ', '!', '「', '']) {
			expect(hoverable(ch), ch).toBe(false);
		}
	});
});
