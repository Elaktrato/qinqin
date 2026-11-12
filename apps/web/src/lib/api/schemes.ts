import { api } from './client';
import type { EntryBase, Scheme } from './types';

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
