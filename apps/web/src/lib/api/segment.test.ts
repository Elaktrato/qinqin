import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError } from './client';
import { segmentAt, segmentBatch, segmentWithReadings, windowAt } from './segment';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function requestedURL(): URL {
	return new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://localhost');
}

describe('windowAt', () => {
	it('slices by code point so astral characters stay whole', () => {
		expect(windowAt('a𠮷b', 1)).toBe('𠮷b');
		expect(windowAt('a𠮷b', 1, 1)).toBe('𠮷');
		expect(windowAt('a𠮷b', 2)).toBe('b');
	});

	it('caps the window at 16 code points by default', () => {
		const text = '𠮷'.repeat(40);
		expect(Array.from(windowAt(text, 3)!)).toHaveLength(16);
	});

	it('returns null at or past the end and for negative offsets', () => {
		expect(windowAt('a𠮷b', 3)).toBeNull();
		expect(windowAt('a𠮷b', 99)).toBeNull();
		expect(windowAt('a𠮷b', -1)).toBeNull();
		expect(windowAt('', 0)).toBeNull();
	});

	it('returns the last character at the final offset', () => {
		expect(windowAt('abc', 2)).toBe('c');
	});
});

describe('segmentAt', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => null });
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('requests a window at offset 0 and returns null for {"match":null}', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ match: null }));

		expect(await segmentAt('zh', '你好世界', 2)).toBeNull();

		const url = requestedURL();
		expect(url.pathname).toBe('/api/segment/at');
		expect(url.searchParams.get('lang')).toBe('zh');
		expect(url.searchParams.get('text')).toBe('世界');
		expect(url.searchParams.get('offset')).toBe('0');
		expect(vi.mocked(fetch).mock.calls[0][1]?.method).toBe('GET');
	});

	it('never sends more than 16 code points', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ match: null }));

		await segmentAt('zh', '字'.repeat(5000), 10);

		expect(Array.from(requestedURL().searchParams.get('text')!)).toHaveLength(16);
	});

	it('translates start and end back by the original offset, with an astral char before it', async () => {
		const match = {
			surface: '世界',
			start: 0,
			end: 2,
			lemma: '世界',
			reason: 'dict',
			entries: [{ id: 7, kind: 'word' }]
		};
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ match }));

		const result = await segmentAt('zh', '𠮷好世界', 2);

		expect(requestedURL().searchParams.get('text')).toBe('世界');
		expect(result).toEqual({ ...match, start: 2, end: 4 });
	});

	it('makes no request for an out-of-range offset', async () => {
		expect(await segmentAt('zh', 'abc', 3)).toBeNull();
		expect(await segmentAt('zh', 'abc', -1)).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('passes the abort signal to fetch', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ match: null }));
		const controller = new AbortController();

		await segmentAt('zh', 'abc', 0, controller.signal);

		expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
	});

	it('maps error statuses to ApiError', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('unsupported language', { status: 400 }));
		await expect(segmentAt('xx', 'abc', 0)).rejects.toMatchObject({
			name: 'ApiError',
			status: 400
		});
	});
});

describe('segmentBatch', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => null });
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('POSTs lang and text and returns the matches', async () => {
		const matches = [
			{
				surface: '你',
				start: 0,
				end: 1,
				lemma: '你',
				reason: 'dict',
				entries: [{ id: 1, kind: 'character' }]
			}
		];
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ matches }));
		const controller = new AbortController();

		const result = await segmentBatch('zh', '你好', controller.signal);

		expect(result).toEqual(matches);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/segment');
		expect(init?.method).toBe('POST');
		expect(JSON.parse(String(init?.body))).toEqual({ lang: 'zh', text: '你好' });
		expect(init?.signal).toBe(controller.signal);
	});

	it('surfaces 413 as ApiError', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('text too long', { status: 413 }));
		const err = await segmentBatch('zh', 'x').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(413);
	});
});

describe('segmentWithReadings', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', { getItem: () => null });
		vi.stubGlobal('fetch', vi.fn());
	});
	afterEach(() => vi.unstubAllGlobals());

	it('asks for readings and returns the matches', async () => {
		const matches = [
			{ surface: '你好', start: 0, end: 2, lemma: '你好', reason: '', entries: [{ id: 1, kind: 'word' }], reading: { type: 'pinyin', value: 'nǐ hǎo' } }
		];
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ matches }));
		const controller = new AbortController();
		const result = await segmentWithReadings('zh', '你好', controller.signal);
		expect(result).toEqual(matches);
		const [url, init] = vi.mocked(fetch).mock.calls[0];
		expect(url).toBe('/api/segment');
		expect(JSON.parse(String(init?.body))).toEqual({ lang: 'zh', text: '你好', readings: true });
		expect(init?.signal).toBe(controller.signal);
	});
});
