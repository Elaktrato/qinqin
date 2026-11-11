import { api } from './client';
import type { SearchHit } from './types';

export interface SearchOptions {
	kind?: string;
	scheme?: string;
	level?: string;
}

/**
 * search queries GET /api/search for `q` in the language `lang`. Only
 * the options the caller provides are sent; the API defaults the rest.
 * Search is public, so no bearer token is attached.
 */
export async function search(
	lang: string,
	q: string,
	opts: SearchOptions = {}
): Promise<SearchHit[]> {
	const params = new URLSearchParams();
	params.set('q', q);
	params.set('lang', lang);
	if (opts.kind) params.set('kind', opts.kind);
	if (opts.scheme) params.set('scheme', opts.scheme);
	if (opts.level) params.set('level', opts.level);

	return api<SearchHit[]>(`/api/search?${params.toString()}`, { auth: false });
}
