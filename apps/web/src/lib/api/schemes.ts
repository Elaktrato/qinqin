import { api } from './client';
import type { SchemeLevelMembers } from '$lib/studycore/charGroups';
import type { EntryBase, Scheme } from './types';
import type { SchemeCache } from '../context/caches';


/**
 * getSchemes queries GET /api/schemes: every installed level scheme with
 * its ordered levels. The list is public and workspace-independent, so a
 * page filters it by the current workspace's language.
 */
export function getSchemes(): Promise<Scheme[]> {
	return api<Scheme[]>('/api/schemes');
}

/**
 * getSchemeEntries queries GET /api/schemes/{id}/entries. With a level
 * name the API serves only that level's members: words plus the
 * characters derived from them. Entries are listing rows, so the review
 * runner still fetches a full entry by id for its sentences and glosses.
 */
export function getSchemeEntries(schemeId: number, level?: string): Promise<EntryBase[]> {
	const params = new URLSearchParams();
	if (level !== undefined) params.set('level', level);
	const query = params.toString();
	return api<EntryBase[]>(`/api/schemes/${schemeId}/entries${query ? `?${query}` : ''}`);
}

/** The body of GET /api/schemes/{id}/characters, as served. */
interface SchemeCharactersBody {
	levels?: unknown;
}

// A scheme's characters change only when its pack is re-installed, so a
// loaded scheme stays in memory for the session; revalidation across
// visits is the browser cache's job (the server sends a weak ETag with
// `max-age=0, must-revalidate`). Concurrent callers share one request.

function toLevels(body: SchemeCharactersBody | null): SchemeLevelMembers[] {
	const raw = Array.isArray(body?.levels) ? body.levels : [];
	const levels: SchemeLevelMembers[] = [];
	for (const item of raw) {
		if (item === null || typeof item !== 'object') continue;
		const { id, name, chars } = item as {
			id?: unknown;
			name?: unknown;
			chars?: unknown;
		};
		if (typeof id !== 'number' || typeof name !== 'string') continue;
		levels.push({
			levelId: id,
			name,
			chars: new Set(typeof chars === 'string' ? Array.from(chars) : [])
		});
	}
	return levels;
}

/**
 * fetchSchemeCharacters loads GET /api/schemes/{id}/characters: the
 * scheme's levels in level order, each with the Han characters that
 * belong to it (lowest level wins, the rule the server derives badges
 * by), in the shape `buildSections` takes. A loaded scheme is kept in
 * memory; concurrent callers share one request; errors are not cached
 * (HTTP errors arrive as ApiError).
 */
export function fetchSchemeCharacters(cache: SchemeCache, schemeId: number): Promise<SchemeLevelMembers[]> {
	const cached = cache.loadedSchemes.get(schemeId);
	if (cached !== undefined) return Promise.resolve(cached);
	const inFlight = cache.pendingSchemes.get(schemeId);
	if (inFlight !== undefined) return inFlight;
	const promise = api<SchemeCharactersBody | null>(`/api/schemes/${schemeId}/characters`).then(
		(body) => {
			const levels = toLevels(body);
			if (cache.pendingSchemes.get(schemeId) === promise) {
				cache.pendingSchemes.delete(schemeId);
				cache.loadedSchemes.set(schemeId, levels);
			}
			return levels;
		},
		(error: unknown) => {
			if (cache.pendingSchemes.get(schemeId) === promise) cache.pendingSchemes.delete(schemeId);
			throw error;
		}
	);
	cache.pendingSchemes.set(schemeId, promise);
	return promise;
}
