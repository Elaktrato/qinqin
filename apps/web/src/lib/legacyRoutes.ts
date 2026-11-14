// Old URLs that moved: where a bookmark or an old link lands now.

import { normalizePath } from './routeAccess';

/**
 * legacyRedirect maps the map's old URL (/study/map) to its place under
 * Stats, keeping the query and fragment; null for any other path.
 */
export function legacyRedirect(url: {
	pathname: string;
	search: string;
	hash: string;
}): string | null {
	if (normalizePath(url.pathname) !== '/study/map') return null;
	return `/stats/characters${url.search}${url.hash}`;
}
