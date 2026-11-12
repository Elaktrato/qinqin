import { describe, expect, it } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import {
	codePointToUtf16,
	pickEntry,
	preferredEntry,
	selectionTarget,
	utf16ToCodePoint
} from './lookup';

function match(entries: SegmentMatch['entries']): SegmentMatch {
	return { surface: '学习', start: 0, end: 2, lemma: '学习', reason: '', entries };
}

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

	it('round-trips every code point boundary', () => {
		const text = '𠮷野家で食べた';
		for (let cp = 0; cp <= Array.from(text).length; cp++) {
			expect(utf16ToCodePoint(text, codePointToUtf16(text, cp))).toBe(cp);
		}
	});
});

describe('pickEntry', () => {
	const both = match([
		{ id: 1, kind: 'character' },
		{ id: 2, kind: 'word' }
	]);

	it('returns the candidate of the requested kind', () => {
		expect(pickEntry(both, 'character')).toEqual({ id: 1, kind: 'character' });
		expect(pickEntry(both, 'word')).toEqual({ id: 2, kind: 'word' });
	});

	it('returns undefined when no candidate of that kind exists', () => {
		expect(pickEntry(match([{ id: 2, kind: 'word' }]), 'character')).toBeUndefined();
		expect(pickEntry(match([]), 'word')).toBeUndefined();
	});
});

describe('preferredEntry', () => {
	it('prefers the requested kind and falls back to the other', () => {
		const both = match([
			{ id: 1, kind: 'character' },
			{ id: 2, kind: 'word' }
		]);
		expect(preferredEntry(both, 'word')).toEqual({ id: 2, kind: 'word' });
		expect(preferredEntry(both, 'character')).toEqual({ id: 1, kind: 'character' });
		expect(preferredEntry(match([{ id: 1, kind: 'character' }]), 'word')).toEqual({
			id: 1,
			kind: 'character'
		});
		expect(preferredEntry(match([{ id: 2, kind: 'word' }]), 'character')).toEqual({
			id: 2,
			kind: 'word'
		});
	});

	it('returns undefined without a match or candidates', () => {
		expect(preferredEntry(null, 'word')).toBeUndefined();
		expect(preferredEntry(match([]), 'character')).toBeUndefined();
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
