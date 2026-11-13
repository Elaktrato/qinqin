import { describe, expect, it, vi } from 'vitest';
import { loadStrokeData, resetStrokeDataCache, strokeUrl } from './strokeData';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

describe('strokeUrl', () => {
	it('uses upper-case hex codepoint names', () => {
		expect(strokeUrl('学')).toBe('/hanzi/U5B66.json');
		expect(strokeUrl('好')).toBe('/hanzi/U597D.json');
	});
	it('handles astral characters', () => {
		expect(strokeUrl('𠀀')).toBe('/hanzi/U20000.json');
	});
});

describe('loadStrokeData', () => {
	it('returns parsed data and caches per character', async () => {
		resetStrokeDataCache();
		const fetchFn = vi.fn(async () => jsonResponse({ strokes: [1] }));
		expect(await loadStrokeData('学', fetchFn as unknown as typeof fetch)).toEqual({ strokes: [1] });
		expect(await loadStrokeData('学', fetchFn as unknown as typeof fetch)).toEqual({ strokes: [1] });
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledWith('/hanzi/U5B66.json');
	});
	it('returns null on 404 and caches the negative', async () => {
		resetStrokeDataCache();
		const fetchFn = vi.fn(async () => jsonResponse({}, 404));
		expect(await loadStrokeData('好', fetchFn as unknown as typeof fetch)).toBeNull();
		expect(await loadStrokeData('好', fetchFn as unknown as typeof fetch)).toBeNull();
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
	it('returns null on network error without caching, so a retry succeeds', async () => {
		resetStrokeDataCache();
		const boom = vi.fn(async () => {
			throw new Error('offline');
		});
		expect(await loadStrokeData('学', boom as unknown as typeof fetch)).toBeNull();
		const ok = vi.fn(async () => jsonResponse({ a: 1 }));
		expect(await loadStrokeData('学', ok as unknown as typeof fetch)).toEqual({ a: 1 });
	});
	it('caches invalid JSON as a definitive negative', async () => {
		resetStrokeDataCache();
		const bad = vi.fn(async () => new Response('not json', { status: 200 }));
		expect(await loadStrokeData('好', bad as unknown as typeof fetch)).toBeNull();
		expect(await loadStrokeData('好', bad as unknown as typeof fetch)).toBeNull();
		expect(bad).toHaveBeenCalledTimes(1);
	});
	it('shares one request between concurrent callers', async () => {
		resetStrokeDataCache();
		const fetchFn = vi.fn(async () => jsonResponse({ a: 1 }));
		const [a, b] = await Promise.all([
			loadStrokeData('学', fetchFn as unknown as typeof fetch),
			loadStrokeData('学', fetchFn as unknown as typeof fetch)
		]);
		expect(a).toEqual(b);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
