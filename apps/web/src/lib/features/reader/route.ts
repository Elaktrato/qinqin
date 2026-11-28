import type { SentenceSource } from '$lib/api/types';

export type ReaderRoute =
	| { view: 'library' }
	| { view: 'sources' }
	| { view: 'book'; id: number; chapter: number };

export const LIBRARY_HREF = '/reader';
export const SOURCES_HREF = '/reader/sources';

export function bookHref(id: number, chapter = 0): string {
	return `${LIBRARY_HREF}/book/${id}/${chapter}`;
}

/** safeHttpUrl returns url when it is an http(s) link, else '' (never a javascript: or data: URL). */
export function safeHttpUrl(url: string): string {
	return url.startsWith('https://') || url.startsWith('http://') ? url : '';
}

const library: ReaderRoute = { view: 'library' };

// A plain non-negative decimal integer; rejects signs, fractions, exponents.
function parseIndex(part: string): number | null {
	if (!/^\d+$/.test(part)) return null;
	const n = Number(part);
	return Number.isSafeInteger(n) ? n : null;
}

/** Maps the part of the URL after /reader to a view; unknown input is the library. */
export function parseRoute(rest: string): ReaderRoute {
	const parts = rest.split('/').filter((part) => part !== '');
	if (parts.length === 0) return library;
	if (parts[0] === 'sources' && parts.length === 1) return { view: 'sources' };
	if (parts[0] === 'book' && (parts.length === 2 || parts.length === 3)) {
		const id = parseIndex(parts[1]);
		const chapter = parts.length === 3 ? parseIndex(parts[2]) : 0;
		if (id !== null && id > 0 && chapter !== null) return { view: 'book', id, chapter };
	}
	return library;
}

/** The contract's caps of a source's place (reader/sentence-sources.json `limits`). */
export const MAX_SOURCE_PARAGRAPH = 100000;
export const MAX_SOURCE_OFFSET = 100000;

/** A word's place in the open chapter: paragraph and code-point range [start, end). */
export interface SourcePlace {
	paragraph: number;
	start: number;
	end: number;
}

/**
 * sourceHref is the reader link of a saved sentence's source (#280):
 * /reader/book/{bookId}/{chapter}?at={paragraph}:{start}-{end}; null when
 * there is no book to open (deleted, or not a book source).
 */
export function sourceHref(source: SentenceSource): string | null {
	if (source.kind !== 'book' || source.bookId === null) return null;
	return `${bookHref(source.bookId, source.chapter)}?at=${source.paragraph}:${source.start}-${source.end}`;
}

/** parseAt reads the reader's `at` parameter; anything malformed or out of range is null. */
export function parseAt(at: string | null): SourcePlace | null {
	const m = /^(\d+):(\d+)-(\d+)$/.exec(at ?? '');
	if (!m) return null;
	const [paragraph, start, end] = [m[1], m[2], m[3]].map(Number);
	if (paragraph > MAX_SOURCE_PARAGRAPH || start >= end || end > MAX_SOURCE_OFFSET) return null;
	return { paragraph, start, end };
}
