import { describe, expect, it, vi } from 'vitest';
import type { LookupResult } from '$lib/api/types';
import { LOOKUP_WINDOW } from '$lib/api/lookup';
import { cachedLookup } from './lookupCache';

function result(term: string, start: number): LookupResult {
	const end = start + Array.from(term).length;
	return {
		entryId: 1,
		kind: 'word',
		term,
		reading: '',
		forms: [],
		readings: [],
		matched: term,
		start,
		end,
		reasons: [],
		tags: [],
		frequencies: [],
		senses: [],
		pri: 0
	};
}

// Two-code-point "words" at the offset.
function fake() {
	return vi.fn(
		async (_lang: string, text: string, offset: number, _kinds?: string[], _signal?: AbortSignal) => [
			result(Array.from(text).slice(offset, offset + 2).join(''), offset)
		]
	);
}

describe('cachedLookup', () => {
	it('reuses results for the same language, kinds and window, translating offsets', async () => {
		const inner = fake();
		const lookup = cachedLookup(inner, 10);
		expect(await lookup('zh', '我学习', 1)).toMatchObject([{ term: '学习', start: 1, end: 3 }]);
		// Same window ("学习") at a different offset in another text.
		expect(await lookup('zh', '你们学习', 2)).toMatchObject([{ term: '学习', start: 2, end: 4 }]);
		expect(inner).toHaveBeenCalledTimes(1);
		expect(inner).toHaveBeenCalledWith('zh', '学习', 0, undefined, undefined);
		await lookup('ja', '学习', 0);
		await lookup('zh', '学习', 0, ['character']);
		expect(inner).toHaveBeenCalledTimes(3);
	});

	it('keys on the code points the engine reads (LOOKUP_WINDOW, 12)', async () => {
		const inner = fake();
		const lookup = cachedLookup(inner, 10);
		const head = '一二三四五六七八九十百千'; // 12 code points
		expect(Array.from(head)).toHaveLength(LOOKUP_WINDOW);
		await lookup('zh', head + '万亿', 0);
		await lookup('zh', head + '兆京', 0);
		expect(inner).toHaveBeenCalledTimes(1);
		expect(inner).toHaveBeenCalledWith('zh', head, 0, undefined, undefined);
	});

	it('passes kinds and the signal through', async () => {
		const inner = fake();
		const signal = new AbortController().signal;
		await cachedLookup(inner, 10)('zh', '学', 0, ['character'], signal);
		expect(inner).toHaveBeenCalledWith('zh', '学', 0, ['character'], signal);
	});

	it('caches empty lists too but never failures', async () => {
		const inner = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce([]);
		const lookup = cachedLookup(inner, 10);
		expect(await lookup('zh', '。', 0)).toEqual([]);
		expect(await lookup('zh', '。', 0)).toEqual([]);
		await expect(lookup('zh', '？', 0)).rejects.toThrow('offline');
		expect(await lookup('zh', '？', 0)).toEqual([]);
		expect(inner).toHaveBeenCalledTimes(3);
	});

	it('does not call through for an out-of-range offset', async () => {
		const inner = fake();
		expect(await cachedLookup(inner, 10)('zh', 'ab', 5)).toEqual([]);
		expect(inner).not.toHaveBeenCalled();
	});

	it('evicts the oldest entries beyond its size', async () => {
		const inner = fake();
		const lookup = cachedLookup(inner, 2);
		await lookup('zh', 'a', 0);
		await lookup('zh', 'b', 0);
		await lookup('zh', 'c', 0);
		await lookup('zh', 'a', 0);
		expect(inner).toHaveBeenCalledTimes(4);
		await lookup('zh', 'c', 0);
		expect(inner).toHaveBeenCalledTimes(4);
	});
});
