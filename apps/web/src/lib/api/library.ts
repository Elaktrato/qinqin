import { api } from './client';
import type { Book, Bookmark, Chapter, SourceInfo, SourceResult } from './types';

/** listBooks lists the books of one workspace's library. */
export function listBooks(workspaceId: number): Promise<Book[]> {
	const query = new URLSearchParams({ workspace: String(workspaceId) });
	return api<Book[]>(`/api/library/books?${query}`);
}

export function getBook(id: number): Promise<Book> {
	return api<Book>(`/api/library/books/${id}`);
}

export function getChapter(id: number, n: number): Promise<Chapter> {
	return api<Chapter>(`/api/library/books/${id}/chapters/${n}`);
}

export function setPosition(id: number, position: string): Promise<void> {
	return api<void>(`/api/library/books/${id}/position`, { method: 'PUT', body: { position } });
}

export function deleteBook(id: number): Promise<void> {
	return api<void>(`/api/library/books/${id}`, { method: 'DELETE' });
}

export function listBookmarks(bookId: number): Promise<Bookmark[]> {
	return api<Bookmark[]>(`/api/library/books/${bookId}/bookmarks`);
}

/**
 * addBookmark sets a bookmark at a reading position. When one already
 * exists at that position the server returns it (200) instead of a new
 * one (201); at the cap of 200 per book it answers 409.
 */
export function addBookmark(bookId: number, position: string, label: string): Promise<Bookmark> {
	return api<Bookmark>(`/api/library/books/${bookId}/bookmarks`, {
		method: 'POST',
		body: { position, label }
	});
}

/** renameBookmark sets the label; the server returns the bookmark with its cleaned label. */
export function renameBookmark(bookId: number, id: number, label: string): Promise<Bookmark> {
	return api<Bookmark>(`/api/library/books/${bookId}/bookmarks/${id}`, {
		method: 'PUT',
		body: { label }
	});
}

export function deleteBookmark(bookId: number, id: number): Promise<void> {
	return api<void>(`/api/library/books/${bookId}/bookmarks/${id}`, { method: 'DELETE' });
}

/**
 * uploadBook uploads an epub into a workspace's library (multipart field
 * `file`, form field `workspace`). `language` is only used by the server
 * when the epub does not declare one; a book in another language than the
 * workspace's is refused (422).
 */
export function uploadBook(file: File, workspaceId: number, language?: string): Promise<Book> {
	const form = new FormData();
	form.append('file', file);
	form.append('workspace', String(workspaceId));
	if (language) form.append('language', language);
	return api<Book>('/api/library/upload', { method: 'POST', body: form });
}

export function listSources(): Promise<SourceInfo[]> {
	return api<SourceInfo[]>('/api/library/sources');
}

/** SOURCE_SEARCH_LIMIT is the most results a source search returns (the server max). */
export const SOURCE_SEARCH_LIMIT = 100;

export function searchSource(source: string, q: string): Promise<SourceResult[]> {
	const query = new URLSearchParams({ q, limit: String(SOURCE_SEARCH_LIMIT) });
	return api<SourceResult[]>(`/api/library/sources/${encodeURIComponent(source)}/search?${query}`);
}

/** importFromSource imports a work into a workspace's library (409 when it is already there). */
export function importFromSource(source: string, sourceId: string, workspaceId: number): Promise<Book> {
	return api<Book>(`/api/library/sources/${encodeURIComponent(source)}/import`, {
		method: 'POST',
		body: { sourceId, workspaceId }
	});
}

/** BROWSE_LIMIT is the size of the browse assortment ("Suggestions for today"). */
export const BROWSE_LIMIT = 12;

/**
 * browseSource fetches an assortment of a source's works in `language`:
 * the same for the same seed (the server defaults to today's UTC date).
 * An empty list means the catalog is empty or not available yet; a 501
 * means the source has no assortment.
 */
export function browseSource(
	source: string,
	opts: { language?: string; seed?: string; limit?: number } = {}
): Promise<SourceResult[]> {
	const query = new URLSearchParams();
	if (opts.language) query.set('language', opts.language);
	if (opts.seed) query.set('seed', opts.seed);
	query.set('limit', String(opts.limit ?? BROWSE_LIMIT));
	return api<SourceResult[]>(`/api/library/sources/${encodeURIComponent(source)}/browse?${query}`);
}
