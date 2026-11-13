import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError } from './client';
import {
	BROWSE_LIMIT,
	browseSource,
	deleteBook,
	getBook,
	getChapter,
	importFromSource,
	listBooks,
	listSources,
	searchSource,
	setPosition,
	uploadBook
} from './library';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function lastCall() {
	const [url, init] = vi.mocked(fetch).mock.calls[0];
	return { url: String(url), init: init as RequestInit };
}

describe('library client', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => (k === 'qinqin.token' ? 'tok' : null)
		});
		vi.stubGlobal('fetch', vi.fn());
		goto.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('listBooks GETs the books of one workspace', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
		expect(await listBooks(7)).toEqual([]);
		const { url, init } = lastCall();
		expect(url).toBe('/api/library/books?workspace=7');
		expect(init.method).toBe('GET');
		expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
	});

	it('getBook GETs one book', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 3 }));
		expect(await getBook(3)).toEqual({ id: 3 });
		expect(lastCall().url).toBe('/api/library/books/3');
	});

	it('getChapter GETs a chapter', async () => {
		const chapter = { title: 'One', paragraphs: [[{ text: '漢', ruby: 'kan' }]] };
		vi.mocked(fetch).mockResolvedValue(jsonResponse(chapter));
		expect(await getChapter(3, 2)).toEqual(chapter);
		expect(lastCall().url).toBe('/api/library/books/3/chapters/2');
	});

	it('setPosition PUTs {position}', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		await setPosition(3, '2:5');
		const { url, init } = lastCall();
		expect(url).toBe('/api/library/books/3/position');
		expect(init.method).toBe('PUT');
		expect(JSON.parse(String(init.body))).toEqual({ position: '2:5' });
	});

	it('deleteBook DELETEs the book', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		await deleteBook(3);
		const { url, init } = lastCall();
		expect(url).toBe('/api/library/books/3');
		expect(init.method).toBe('DELETE');
	});

	it('uploadBook sends FormData with file, workspace and language, without a JSON content type', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 1 }, 201));
		const file = new File(['x'], 'b.epub', { type: 'application/epub+zip' });

		await uploadBook(file, 7, 'ja');

		const { url, init } = lastCall();
		expect(url).toBe('/api/library/upload');
		expect(init.method).toBe('POST');
		expect(init.body).toBeInstanceOf(FormData);
		const form = init.body as FormData;
		expect((form.get('file') as File).name).toBe('b.epub');
		expect(form.get('workspace')).toBe('7');
		expect(form.get('language')).toBe('ja');
		expect(new Headers(init.headers).get('content-type')).toBeNull();
	});

	it('uploadBook omits language when not given but always sends the workspace', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 1 }, 201));
		await uploadBook(new File(['x'], 'b.epub'), 3);
		const form = lastCall().init.body as FormData;
		expect(form.has('language')).toBe(false);
		expect(form.get('workspace')).toBe('3');
	});

	it('listSources GETs /api/library/sources', async () => {
		const sources = [{ id: 'gutenberg', name: 'Project Gutenberg', languages: ['zh'] }];
		vi.mocked(fetch).mockResolvedValue(jsonResponse(sources));
		expect(await listSources()).toEqual(sources);
		expect(lastCall().url).toBe('/api/library/sources');
	});

	it('searchSource encodes the source and query', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
		await searchSource('guten berg', 'a b&c');
		const url = new URL(lastCall().url, 'http://localhost');
		expect(url.pathname).toBe('/api/library/sources/guten%20berg/search');
		expect(url.searchParams.get('q')).toBe('a b&c');
		expect(url.searchParams.get('limit')).toBe('100');
	});

	it('importFromSource POSTs {sourceId, workspaceId}', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ id: 9 }, 201));
		await importFromSource('gutenberg', '23962', 7);
		const { url, init } = lastCall();
		expect(url).toBe('/api/library/sources/gutenberg/import');
		expect(init.method).toBe('POST');
		expect(JSON.parse(String(init.body))).toEqual({ sourceId: '23962', workspaceId: 7 });
	});

	it('browseSource GETs the assortment with language, seed and limit', async () => {
		const items = [{ sourceId: '1', title: 'T', author: 'A', language: 'ja', note: '' }];
		vi.mocked(fetch).mockResolvedValue(jsonResponse(items));
		expect(await browseSource('ao zora', { language: 'ja', seed: '2026-11-13' })).toEqual(items);
		const url = new URL(lastCall().url, 'http://localhost');
		expect(url.pathname).toBe('/api/library/sources/ao%20zora/browse');
		expect(url.searchParams.get('language')).toBe('ja');
		expect(url.searchParams.get('seed')).toBe('2026-11-13');
		expect(url.searchParams.get('limit')).toBe(String(BROWSE_LIMIT));
		expect(BROWSE_LIMIT).toBe(12);
	});

	it('browseSource leaves out a missing language and seed', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse([]));
		await browseSource('gutenberg', { limit: 5 });
		const url = new URL(lastCall().url, 'http://localhost');
		expect(url.searchParams.has('language')).toBe(false);
		expect(url.searchParams.has('seed')).toBe(false);
		expect(url.searchParams.get('limit')).toBe('5');
	});

	it.each([404, 409, 413, 422, 429, 502])('surfaces status %i as ApiError', async (status) => {
		vi.mocked(fetch).mockResolvedValue(new Response('nope', { status }));
		const err = await importFromSource('gutenberg', '1', 7).catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(status);
	});
});
