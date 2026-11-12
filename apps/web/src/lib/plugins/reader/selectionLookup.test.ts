import { describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import { START_NOTE, lookupSelection, selectionSpanTarget } from './selectionLookup';

type Dictionary = Record<string, LookupResult['kind']>;

const base: Dictionary = {
	学: 'character',
	学习: 'word',
	中: 'character',
	中文: 'word'
};

function result(term: string, kind: LookupResult['kind'], start: number): LookupResult {
	return {
		entryId: term.length,
		kind,
		term,
		reading: '',
		forms: [],
		readings: [],
		matched: term,
		start,
		end: start + Array.from(term).length,
		reasons: [],
		tags: [],
		frequencies: [],
		senses: [],
		pri: 0
	};
}

// Every prefix match at the offset, longest first, like the lookup endpoint.
function fakeLookup(words: Dictionary = base) {
	return vi.fn(
		async (_lang: string, text: string, offset: number, kinds?: string[], _signal?: AbortSignal) => {
			const points = Array.from(text);
			const found: LookupResult[] = [];
			for (let end = points.length; end > offset; end--) {
				const term = points.slice(offset, end).join('');
				const kind = words[term];
				if (kind && (!kinds || kinds.includes(kind))) found.push(result(term, kind, offset));
			}
			return found;
		}
	);
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
	it('looks a single character up as a character entry, on its own', async () => {
		const lookup = fakeLookup();
		const target = { start: 3, end: 4, text: '学', kind: 'character' as const };
		const found = await lookupSelection('zh', '我们在学习', target, lookup);
		expect(found.note).toBe('');
		expect(found.results).toMatchObject([{ term: '学', kind: 'character', start: 3, end: 4 }]);
		expect(lookup).toHaveBeenCalledWith('zh', '学', 0, ['character'], undefined);
		expect(lookup).toHaveBeenCalledTimes(1);
	});

	it('keeps only the results covering a selection that is a word itself', async () => {
		const lookup = fakeLookup({ ...base, 中文课: 'word' });
		const target = { start: 0, end: 2, text: '中文', kind: 'word' as const };
		const found = await lookupSelection('zh', '中文课本', target, lookup);
		expect(found).toMatchObject({ note: '', results: [{ term: '中文', start: 0, end: 2 }] });
		expect(found.results).toHaveLength(1);
		expect(lookup).toHaveBeenCalledWith('zh', '中文', 0, undefined, undefined);
		expect(lookup).toHaveBeenCalledTimes(1);
	});

	it('uses the paragraph results covering the selection when it is no word itself', async () => {
		const lookup = fakeLookup({ 中: 'character', 中文课: 'word' });
		const target = { start: 1, end: 3, text: '中文', kind: 'word' as const };
		const found = await lookupSelection('zh', '学中文课本', target, lookup);
		expect(found).toMatchObject({ note: '', results: [{ term: '中文课', start: 1, end: 4 }] });
		expect(found.results).toHaveLength(1);
	});

	it('falls back to the matches at the start with a note when nothing covers the selection', async () => {
		const lookup = fakeLookup();
		const target = { start: 0, end: 4, text: '学习中文', kind: 'word' as const };
		const found = await lookupSelection('zh', '学习中文', target, lookup);
		expect(found.note).toBe(START_NOTE);
		expect(found.results.map((r) => r.term)).toEqual(['学习', '学']);
	});

	it('reports no results without a note when the start matches nothing', async () => {
		const target = { start: 0, end: 2, text: '你好', kind: 'word' as const };
		expect(await lookupSelection('zh', '你好', target, fakeLookup())).toEqual({ results: [], note: '' });
	});

	it('passes the abort signal through', async () => {
		const lookup = fakeLookup();
		const signal = new AbortController().signal;
		const target = { start: 0, end: 4, text: '学习中文', kind: 'word' as const };
		await lookupSelection('zh', '学习中文', target, lookup, signal);
		expect(lookup).toHaveBeenLastCalledWith('zh', '学习中文', 0, undefined, signal);
	});
});
