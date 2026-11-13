import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError } from './client';
import { clearCharacterCache, fetchCharacters } from './characters';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function requestedURL(call = 0): URL {
	return new URL(String(vi.mocked(fetch).mock.calls[call][0]), 'http://localhost');
}

describe('fetchCharacters', () => {
	beforeEach(() => {
		clearCharacterCache();
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('requests GET /api/characters with the language and returns chars and count', async () => {
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse({
				language: 'ja',
				count: 2,
				chars: [
					{ i: 1, c: '一', s: 1, g: 1, j: 4, f: 2, r: 'いち', m: 'one' },
					{ i: 2, c: '二', s: 2 }
				]
			})
		);
		const result = await fetchCharacters('ja');
		const url = requestedURL();
		expect(url.pathname).toBe('/api/characters');
		expect(url.searchParams.get('language')).toBe('ja');
		expect(vi.mocked(fetch).mock.calls[0][1]?.method ?? 'GET').toBe('GET');
		expect(result.count).toBe(2);
		expect(result.chars.map((c) => c.c)).toEqual(['一', '二']);
		expect(result.chars[0]).toEqual({ i: 1, c: '一', s: 1, g: 1, j: 4, f: 2, r: 'いち', m: 'one' });
	});

	it('sends and caches the primary language subtag', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ language: 'zh', count: 0, chars: [] }));
		const tw = await fetchCharacters('zh-TW');
		expect(requestedURL().searchParams.get('language')).toBe('zh');
		const plain = await fetchCharacters('zh');
		const underscore = await fetchCharacters('ZH_hant');
		expect(plain).toBe(tw);
		expect(underscore).toBe(tw);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('encodes the language parameter', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ language: 'a&b', count: 0, chars: [] }));
		await fetchCharacters('a&b');
		expect(requestedURL().searchParams.get('language')).toBe('a&b');
	});

	it('keeps the result in memory per language for the session', async () => {
		vi.mocked(fetch).mockImplementation(async (input) => {
			const lang = new URL(String(input), 'http://localhost').searchParams.get('language');
			return jsonResponse({ language: lang, count: 1, chars: [{ i: lang === 'ja' ? 1 : 2, c: '人' }] });
		});
		const first = await fetchCharacters('ja');
		const second = await fetchCharacters('ja');
		expect(second).toBe(first);
		expect(fetch).toHaveBeenCalledTimes(1);

		const zh = await fetchCharacters('zh');
		expect(zh.chars[0].i).toBe(2);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('shares one in-flight request between concurrent callers', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ language: 'ja', count: 0, chars: [] }));
		const [a, b] = await Promise.all([fetchCharacters('ja'), fetchCharacters('ja')]);
		expect(a).toBe(b);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('normalises a missing chars array to [] and count to its length', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ language: 'es' }));
		const result = await fetchCharacters('es');
		expect(result).toEqual({ chars: [], count: 0 });
	});

	it('passes the stale flag through only when the server sets it', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			jsonResponse({ language: 'ja', count: 1, stale: true, chars: [{ i: 1, c: '一', s: 1 }] })
		);
		const stale = await fetchCharacters('ja');
		expect(stale.stale).toBe(true);

		vi.mocked(fetch).mockResolvedValueOnce(
			jsonResponse({ language: 'zh', count: 0, stale: 'yes', chars: [] })
		);
		const odd = await fetchCharacters('zh');
		expect(odd.stale).toBeUndefined();
		expect(odd).toEqual({ chars: [], count: 0 });
	});

	it('maps HTTP errors to ApiError and does not cache them', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('unsupported language', { status: 400 }));
		const error = await fetchCharacters('xx').catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).status).toBe(400);
		expect((error as ApiError).message).toBe('unsupported language');

		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ language: 'xx', count: 0, chars: [] }));
		await expect(fetchCharacters('xx')).resolves.toEqual({ chars: [], count: 0 });
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('does not cache a network failure', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await expect(fetchCharacters('ja')).rejects.toThrow('Failed to fetch');
		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ language: 'ja', count: 0, chars: [] }));
		await expect(fetchCharacters('ja')).resolves.toEqual({ chars: [], count: 0 });
	});

	it('aborts the request when its only caller aborts and does not cache it', async () => {
		vi.mocked(fetch).mockImplementationOnce((_input, init) => {
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () =>
					reject(new DOMException('aborted', 'AbortError'))
				);
			});
		});
		const controller = new AbortController();
		const pending = fetchCharacters('ja', controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

		vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ language: 'ja', count: 1, chars: [{ i: 1, c: '一' }] }));
		const result = await fetchCharacters('ja');
		expect(result.count).toBe(1);
	});

	it('an aborted caller does not abort another caller sharing the request', async () => {
		let resolveFetch: (value: Response) => void = () => {};
		vi.mocked(fetch).mockImplementationOnce(
			() => new Promise<Response>((resolve) => (resolveFetch = resolve))
		);
		const controller = new AbortController();
		const aborted = fetchCharacters('ja', controller.signal);
		const kept = fetchCharacters('ja');
		controller.abort();
		await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
		resolveFetch(jsonResponse({ language: 'ja', count: 1, chars: [{ i: 1, c: '一' }] }));
		await expect(kept).resolves.toEqual({ chars: [{ i: 1, c: '一' }], count: 1 });
	});
});
