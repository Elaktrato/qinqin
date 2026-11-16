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
