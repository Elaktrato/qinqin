import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { ApiError } from './client';
import {
	BROWSE_LIMIT,
	addBookmark,
	browseSource,
	deleteBook,
	deleteBookmark,
	listBookmarks,
	renameBookmark,
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

	it('listBookmarks GETs the bookmarks of a book', async () => {
		const list = [{ id: 1, bookId: 3, position: '0:2', label: 'x', createdAt: '2026-11-13T00:00:00Z' }];
		vi.mocked(fetch).mockResolvedValue(jsonResponse(list));
		expect(await listBookmarks(3)).toEqual(list);
		const { url, init } = lastCall();
		expect(url).toBe('/api/library/books/3/bookmarks');
		expect(init.method).toBe('GET');
	});

	it('addBookmark POSTs exactly {position, label} and returns the bookmark (201 or 200)', async () => {
		const made = { id: 4, bookId: 3, position: '1:7', label: '猫', createdAt: '2026-11-13T00:00:00Z' };
		for (const status of [201, 200]) {
			vi.mocked(fetch).mockReset();
			vi.mocked(fetch).mockResolvedValue(jsonResponse(made, status));
			expect(await addBookmark(3, '1:7', '猫')).toEqual(made);
			const { url, init } = lastCall();
			expect(url).toBe('/api/library/books/3/bookmarks');
			expect(init.method).toBe('POST');
			expect(JSON.parse(String(init.body))).toStrictEqual({ position: '1:7', label: '猫' });
		}
	});

	it('renameBookmark PUTs exactly {label} and returns the cleaned bookmark', async () => {
		const renamed = { id: 4, bookId: 3, position: '1:7', label: 'new', createdAt: '2026-11-13T00:00:00Z' };
		vi.mocked(fetch).mockResolvedValue(jsonResponse(renamed));
		expect(await renameBookmark(3, 4, ' new ')).toEqual(renamed);
		const { url, init } = lastCall();
		expect(url).toBe('/api/library/books/3/bookmarks/4');
		expect(init.method).toBe('PUT');
		expect(JSON.parse(String(init.body))).toStrictEqual({ label: ' new ' });
	});

	it('deleteBookmark DELETEs the bookmark', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
		await deleteBookmark(3, 4);
		const { url, init } = lastCall();
		expect(url).toBe('/api/library/books/3/bookmarks/4');
		expect(init.method).toBe('DELETE');
	});

	it('surfaces the bookmark cap (409) as ApiError', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('too many bookmarks', { status: 409 }));
		const err = await addBookmark(3, '0:0', '').catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(409);
	});

	it.each([404, 409, 413, 422, 429, 502])('surfaces status %i as ApiError', async (status) => {
		vi.mocked(fetch).mockResolvedValue(new Response('nope', { status }));
		const err = await importFromSource('gutenberg', '1', 7).catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(status);
	});
});
