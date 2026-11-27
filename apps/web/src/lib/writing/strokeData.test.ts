import { StrokeCache } from '$lib/context/caches';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchStrokeData, loadStrokeData, strokeUrl } from './strokeData';

// A fresh StrokeCache per test (record 0009: the session owns one).
let cache = new StrokeCache();
beforeEach(() => {
	cache = new StrokeCache();
});

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
	it('asks for the shapes of a language with ?lang= (docs/contracts/strokes)', () => {
		expect(strokeUrl('海', 'ja')).toBe('/hanzi/U6D77.json?lang=ja');
		expect(strokeUrl('海', 'zh')).toBe('/hanzi/U6D77.json?lang=zh');
	});
	it('leaves out a language the route would refuse', () => {
		for (const lang of [undefined, '', 'JA', 'zh-TW', 'japanese', 'j']) expect(strokeUrl('海', lang)).toBe('/hanzi/U6D77.json');
	});
});

describe('stroke data per language', () => {
	it('keeps the data of each language apart and fetches the language asked for', async () => {
		const fetchFn = vi.fn(async (url: string) => jsonResponse({ url }));
		const as = fetchFn as unknown as typeof fetch;
		expect(await loadStrokeData(cache, '海', as, 'ja')).toEqual({ url: '/hanzi/U6D77.json?lang=ja' });
		expect(await loadStrokeData(cache, '海', as, 'zh')).toEqual({ url: '/hanzi/U6D77.json?lang=zh' });
		expect(await loadStrokeData(cache, '海', as)).toEqual({ url: '/hanzi/U6D77.json' });
		expect(await loadStrokeData(cache, '海', as, 'ja')).toEqual({ url: '/hanzi/U6D77.json?lang=ja' });
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});
	it('treats an unusable language as none, so it shares the plain entry', async () => {
		const fetchFn = vi.fn(async () => jsonResponse({ a: 1 }));
		const as = fetchFn as unknown as typeof fetch;
		await loadStrokeData(cache, '海', as);
		await loadStrokeData(cache, '海', as, 'zh-TW');
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});

describe('loadStrokeData', () => {
	it('returns parsed data and caches per character', async () => {
		cache.clear();
		const fetchFn = vi.fn(async () => jsonResponse({ strokes: [1] }));
		expect(await loadStrokeData(cache, '学', fetchFn as unknown as typeof fetch)).toEqual({ strokes: [1] });
		expect(await loadStrokeData(cache, '学', fetchFn as unknown as typeof fetch)).toEqual({ strokes: [1] });
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(fetchFn).toHaveBeenCalledWith('/hanzi/U5B66.json');
	});
	it('returns null on 404 and caches the negative', async () => {
		cache.clear();
		const fetchFn = vi.fn(async () => jsonResponse({}, 404));
		expect(await loadStrokeData(cache, '好', fetchFn as unknown as typeof fetch)).toBeNull();
		expect(await loadStrokeData(cache, '好', fetchFn as unknown as typeof fetch)).toBeNull();
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
	it('returns null on network error without caching, so a retry succeeds', async () => {
		cache.clear();
		const boom = vi.fn(async () => {
			throw new Error('offline');
		});
		expect(await loadStrokeData(cache, '学', boom as unknown as typeof fetch)).toBeNull();
		const ok = vi.fn(async () => jsonResponse({ a: 1 }));
		expect(await loadStrokeData(cache, '学', ok as unknown as typeof fetch)).toEqual({ a: 1 });
	});
	it('caches invalid JSON as a definitive negative', async () => {
		cache.clear();
		const bad = vi.fn(async () => new Response('not json', { status: 200 }));
		expect(await loadStrokeData(cache, '好', bad as unknown as typeof fetch)).toBeNull();
		expect(await loadStrokeData(cache, '好', bad as unknown as typeof fetch)).toBeNull();
		expect(bad).toHaveBeenCalledTimes(1);
	});
	it('shares one request between concurrent callers', async () => {
		cache.clear();
		const fetchFn = vi.fn(async () => jsonResponse({ a: 1 }));
		const [a, b] = await Promise.all([
			loadStrokeData(cache, '学', fetchFn as unknown as typeof fetch),
			loadStrokeData(cache, '学', fetchFn as unknown as typeof fetch)
		]);
		expect(a).toEqual(b);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});

describe('fetchStrokeData', () => {
	const as = (fn: unknown) => fn as typeof fetch;

	it('tells a missing character (404) from a transient failure', async () => {
		cache.clear();
		expect(await fetchStrokeData(cache, '好', as(vi.fn(async () => jsonResponse({}, 404))))).toEqual({
			kind: 'missing'
		});
		cache.clear();
		expect(
			await fetchStrokeData(cache, '学', as(vi.fn(async () => { throw new Error('offline'); })))
		).toEqual({ kind: 'error' });
		cache.clear();
		expect(await fetchStrokeData(cache, '学', as(vi.fn(async () => jsonResponse({}, 503))))).toEqual({
			kind: 'error'
		});
	});

	it('does not cache a server error, so a retry can succeed', async () => {
		cache.clear();
		await fetchStrokeData(cache, '学', as(vi.fn(async () => jsonResponse({}, 500))));
		const ok = vi.fn(async () => jsonResponse({ a: 1 }));
		expect(await fetchStrokeData(cache, '学', as(ok))).toEqual({ kind: 'ok', data: { a: 1 } });
		expect(ok).toHaveBeenCalledTimes(1);
	});

	it('loadStrokeData stays null for every non-ok result', async () => {
		cache.clear();
		expect(await loadStrokeData(cache, '学', as(vi.fn(async () => jsonResponse({}, 500))))).toBeNull();
	});
});
