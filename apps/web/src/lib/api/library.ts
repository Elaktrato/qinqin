import { api } from './client';
import type { Book, Chapter, SourceInfo, SourceResult } from './types';

export function listBooks(): Promise<Book[]> {
	return api<Book[]>('/api/library/books');
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

/** Uploads an epub (multipart field `file`, optional form `language`). */
export function uploadEpub(file: File, language?: string): Promise<Book> {
	const form = new FormData();
	form.append('file', file);
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

export function importFromSource(source: string, sourceId: string): Promise<Book> {
	return api<Book>(`/api/library/sources/${encodeURIComponent(source)}/import`, {
		method: 'POST',
		body: { sourceId }
	});
}
