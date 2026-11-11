import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { search } from './search';
import type { SearchHit } from './types';

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function hit(id: number, written: string, source: string): SearchHit {
	return {
		id,
		language: 'zh',
		kind: 'character',
		written,
		readings: [{ type: 'pinyin', value: 'hàn', plain: 'han', ord: 0 }],
		attrs: {},
		radicalId: null,
		source
	};
}

/** The URL the client actually requested, parsed so encoding is checked by value. */
function requestedURL(): URL {
	const call = vi.mocked(fetch).mock.calls[0];
	expect(call).toBeDefined();
	return new URL(String(call[0]), 'http://localhost');
}

describe('search', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('builds /api/search with q and lang and parses the hits', async () => {
		const hits = [hit(1, '漢', 'written'), hit(2, '漢字', 'pinyin')];
		vi.mocked(fetch).mockResolvedValue(jsonResponse(hits));

		const result = await search('zh', 'han');

		expect(result).toEqual(hits);
		const url = requestedURL();
		expect(url.pathname).toBe('/api/search');
		expect(url.searchParams.get('q')).toBe('han');
		expect(url.searchParams.get('lang')).toBe('zh');
		expect([...url.searchParams.keys()]).toEqual(['q', 'lang']);
	});

	it('encodes the query and the language', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

		await search('zh-Hant', 'a b&c/漢');

		const raw = String(vi.mocked(fetch).mock.calls[0][0]);
		expect(raw).toContain('/api/search?');
		// The literal special characters must not leak into the query string.
		expect(raw).not.toContain(' ');
		expect(raw).not.toContain('&c');
		expect(raw).not.toContain('/漢');

		const url = requestedURL();
		expect(url.searchParams.get('q')).toBe('a b&c/漢');
		expect(url.searchParams.get('lang')).toBe('zh-Hant');
	});

	it('omits kind, scheme, and level when they are not provided', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

		await search('ja', 'kanji', {});

		const url = requestedURL();
		expect(url.searchParams.has('kind')).toBe(false);
		expect(url.searchParams.has('scheme')).toBe(false);
		expect(url.searchParams.has('level')).toBe(false);
		expect([...url.searchParams.keys()]).toEqual(['q', 'lang']);
	});

	it('passes kind, scheme, and level when provided', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

		await search('ja', 'kanji', { kind: 'character', scheme: '7', level: 'N5' });

		const url = requestedURL();
		expect(url.searchParams.get('kind')).toBe('character');
		expect(url.searchParams.get('scheme')).toBe('7');
		expect(url.searchParams.get('level')).toBe('N5');
	});

	it('never attaches the stored bearer token', async () => {
		localStorage.setItem('qinqin.token', 'secret');
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));

		await search('zh', 'han');

		const [, init] = vi.mocked(fetch).mock.calls[0];
		expect(new Headers(init?.headers).get('authorization')).toBeNull();
	});
});
