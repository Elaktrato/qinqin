// Old URLs that moved: where a bookmark or an old link lands now.

import { normalizePath } from './routeAccess';

// The core features were plugins at /p/<slug>: flashcards and the reader
// until v0.4.0, the journal and grammar until #199. The sub-routes did not
// change.
const FEATURE_PREFIXES = ['/p/flashcards', '/p/reader', '/p/journal', '/p/grammar'];

/**
 * legacyRedirect maps an old URL to where it lives now, keeping the query
 * and fragment: the map's /study/map to Stats -> Characters, and
 * /p/<feature>[/rest] of the four core features to /<feature>[/rest]. null for any other path.
 */
export function legacyRedirect(url: {
	pathname: string;
	search: string;
	hash: string;
}): string | null {
	const path = normalizePath(url.pathname);
	if (path === '/study/map') return `/stats/characters${url.search}${url.hash}`;
	for (const prefix of FEATURE_PREFIXES) {
		if (path === prefix || path.startsWith(`${prefix}/`)) {
			return `${path.slice('/p'.length)}${url.search}${url.hash}`;
		}
	}
	return null;
}
