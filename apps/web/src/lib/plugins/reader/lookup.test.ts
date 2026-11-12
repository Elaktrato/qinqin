import { describe, expect, it } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import {
	codePointToUtf16,
	homophoneNote,
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

describe('homophoneNote', () => {
	const reading = (id: number, kind: 'word' | 'character' = 'word') => ({
		id,
		kind,
		reading: true
	});
	const kana = (entries: SegmentMatch['entries']): SegmentMatch => ({
		surface: 'した',
		start: 0,
		end: 2,
		lemma: 'する',
		reason: 'past',
		entries
	});

	it('counts the other reading candidates of the shown kind and links a search', () => {
		const note = homophoneNote(kana([reading(1), reading(2), reading(3), reading(4, 'character')]), 'word');
		expect(note).toEqual({
			count: 2,
			href: `/search?q=${encodeURIComponent('する')}`,
			text: '2 other entries are read this way — search for it'
		});
	});

	it('uses the singular for one other entry', () => {
		expect(homophoneNote(kana([reading(1), reading(2)]), 'word')?.text).toBe(
			'1 other entry is read this way — search for it'
		);
	});

	it('is null for a single candidate, written-form hits, or no match', () => {
		expect(homophoneNote(kana([reading(1)]), 'word')).toBeNull();
		expect(
			homophoneNote(
				kana([
					{ id: 1, kind: 'word' },
					{ id: 2, kind: 'word' }
				]),
				'word'
			)
		).toBeNull();
		expect(homophoneNote(null, 'word')).toBeNull();
	});

	it('counts the kind actually shown when the preferred kind is missing', () => {
		expect(homophoneNote(kana([reading(1), reading(2)]), 'character')?.count).toBe(1);
	});
});
