import { describe, expect, it, vi } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import { START_NOTE, lookupSelection, selectionSpanTarget } from './selectionLookup';

type Dictionary = Record<string, SegmentMatch['entries']>;

const base: Dictionary = {
	学: [{ id: 1, kind: 'character' }],
	学习: [{ id: 2, kind: 'word' }],
	中: [{ id: 4, kind: 'character' }],
	中文: [{ id: 5, kind: 'word' }]
};

// Longest prefix match at the offset, like the server's tokenizer.
function fakeSegment(words: Dictionary = base) {
	return vi.fn(async (_lang: string, text: string, offset: number, _signal?: AbortSignal) => {
		const points = Array.from(text);
		for (let end = points.length; end > offset; end--) {
			const surface = points.slice(offset, end).join('');
			if (words[surface]) {
				return { surface, start: offset, end, lemma: surface, reason: '', entries: words[surface] };
			}
		}
		return null;
	});
}

describe('selectionSpanTarget', () => {
	it('trims the span and reports the trimmed offsets', () => {
		expect(selectionSpanTarget('我 学习 。', 1, 6)).toEqual({
			start: 2,
			end: 4,
			text: '学习',
			kind: 'word'
		});
		expect(selectionSpanTarget('a𠮷b', 1, 2)).toEqual({
			start: 1,
			end: 2,
			text: '𠮷',
			kind: 'character'
		});
	});

	it('is null for punctuation or empty spans', () => {
		expect(selectionSpanTarget('我。', 1, 2)).toBeNull();
		expect(selectionSpanTarget('我', 1, 1)).toBeNull();
	});
});

describe('lookupSelection', () => {
	it('looks a single character up on its own, not as part of a longer word', async () => {
		const segment = fakeSegment();
		const target = { start: 0, end: 1, text: '学', kind: 'character' as const };
		const result = await lookupSelection('zh', '学习', target, segment);
		expect(result).toEqual({ match: expect.objectContaining({ surface: '学' }), note: '' });
		expect(segment).toHaveBeenCalledWith('zh', '学', 0, undefined);
	});

	it('prefers a word that equals the selection over a longer one', async () => {
		const segment = fakeSegment({ ...base, 中文课: [{ id: 6, kind: 'word' }] });
		const target = { start: 0, end: 2, text: '中文', kind: 'word' as const };
		const result = await lookupSelection('zh', '中文课本', target, segment);
		expect(result).toEqual({ match: expect.objectContaining({ surface: '中文' }), note: '' });
		expect(segment).toHaveBeenCalledTimes(1);
	});

	it('uses the paragraph match when it covers a selection that is no word itself', async () => {
		const segment = fakeSegment({ 中: base['中'], 中文课: [{ id: 6, kind: 'word' }] });
		const target = { start: 1, end: 3, text: '中文', kind: 'word' as const };
		const result = await lookupSelection('zh', '学中文课本', target, segment);
		expect(result).toEqual({
			match: expect.objectContaining({ surface: '中文课', start: 1, end: 4 }),
			note: ''
		});
	});

	it('falls back to the word at the start with a note when nothing covers the selection', async () => {
		const segment = fakeSegment();
		const target = { start: 0, end: 4, text: '学习中文', kind: 'word' as const };
		const result = await lookupSelection('zh', '学习中文', target, segment);
		expect(result).toEqual({
			match: expect.objectContaining({ surface: '学习', start: 0, end: 2 }),
			note: START_NOTE
		});
	});

	it('reports no match without a note when the start matches nothing', async () => {
		const target = { start: 0, end: 2, text: '你好', kind: 'word' as const };
		expect(await lookupSelection('zh', '你好', target, fakeSegment())).toEqual({
			match: null,
			note: ''
		});
	});

	it('passes the abort signal through', async () => {
		const segment = fakeSegment();
		const signal = new AbortController().signal;
		const target = { start: 0, end: 4, text: '学习中文', kind: 'word' as const };
		await lookupSelection('zh', '学习中文', target, segment, signal);
		expect(segment).toHaveBeenLastCalledWith('zh', '学习中文', 0, signal);
	});
});
