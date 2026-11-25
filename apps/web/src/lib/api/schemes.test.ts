import { SchemeCache } from '$lib/context/caches';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError } from './client';
import { fetchSchemeCharacters } from './schemes';

// A fresh SchemeCache per test (record 0009: the session owns one).
let cache = new SchemeCache();
beforeEach(() => {
	cache = new SchemeCache();
});

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('fetchSchemeCharacters', () => {
	beforeEach(() => {
		cache.clear();
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('requests GET /api/schemes/{id}/characters and maps levels to glyph sets in order', async () => {
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse({
				levels: [
					{ id: 11, name: 'N5', chars: '日本𠮷' },
					{ id: 12, name: 'N4', chars: '' }
				]
			})
		);
		const levels = await fetchSchemeCharacters(cache, 3);
		const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://localhost');
		expect(url.pathname).toBe('/api/schemes/3/characters');
		expect(levels.map((l) => [l.levelId, l.name, [...l.chars]])).toEqual([
			[11, 'N5', ['日', '本', '𠮷']],
			[12, 'N4', []]
		]);
	});

	it('tolerates a missing or malformed body', async () => {
		vi.mocked(fetch).mockResolvedValue(
			jsonResponse({
				levels: [{ id: 1, name: '1' }, null, { id: 'x', name: 2, chars: 5 }]
			})
		);
		const levels = await fetchSchemeCharacters(cache, 1);
		expect(levels).toHaveLength(1);
		expect(levels[0].levelId).toBe(1);
		expect(levels[0].chars.size).toBe(0);
	});

	it('caches per scheme and shares a request between concurrent callers', async () => {
		vi.mocked(fetch).mockImplementation(async () =>
			jsonResponse({ levels: [{ id: 1, name: '1', chars: '一' }] })
		);
		const [a, b] = await Promise.all([fetchSchemeCharacters(cache, 1), fetchSchemeCharacters(cache, 1)]);
		expect(a).toBe(b);
		expect(await fetchSchemeCharacters(cache, 1)).toBe(a);
		expect(fetch).toHaveBeenCalledTimes(1);
		await fetchSchemeCharacters(cache, 2);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('does not cache errors', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response('scheme not found', { status: 404 }))
			.mockResolvedValueOnce(jsonResponse({ levels: [{ id: 1, name: '1', chars: '一' }] }));
		await expect(fetchSchemeCharacters(cache, 9)).rejects.toBeInstanceOf(ApiError);
		const levels = await fetchSchemeCharacters(cache, 9);
		expect([...levels[0].chars]).toEqual(['一']);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
});
