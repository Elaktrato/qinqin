import { describe, expect, it, vi } from 'vitest';
import { fetchStrokeData, loadStrokeData, resetStrokeDataCache, strokeUrl } from './strokeData';

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

describe('fetchStrokeData', () => {
	const as = (fn: unknown) => fn as typeof fetch;

	it('tells a missing character (404) from a transient failure', async () => {
		resetStrokeDataCache();
		expect(await fetchStrokeData('好', as(vi.fn(async () => jsonResponse({}, 404))))).toEqual({
			kind: 'missing'
		});
		resetStrokeDataCache();
		expect(
			await fetchStrokeData('学', as(vi.fn(async () => { throw new Error('offline'); })))
		).toEqual({ kind: 'error' });
		resetStrokeDataCache();
		expect(await fetchStrokeData('学', as(vi.fn(async () => jsonResponse({}, 503))))).toEqual({
			kind: 'error'
		});
	});

	it('does not cache a server error, so a retry can succeed', async () => {
		resetStrokeDataCache();
		await fetchStrokeData('学', as(vi.fn(async () => jsonResponse({}, 500))));
		const ok = vi.fn(async () => jsonResponse({ a: 1 }));
		expect(await fetchStrokeData('学', as(ok))).toEqual({ kind: 'ok', data: { a: 1 } });
		expect(ok).toHaveBeenCalledTimes(1);
	});

	it('loadStrokeData stays null for every non-ok result', async () => {
		resetStrokeDataCache();
		expect(await loadStrokeData('学', as(vi.fn(async () => jsonResponse({}, 500))))).toBeNull();
	});
});
