import { api } from './client';
import type { Entry, EntryBase, EntryDetail } from './types';

/**
 * getEntry queries GET /api/entries/{id}. With a stored bearer token the
 * API layers the caller's overlay on top of the shared entry; anonymous
 * callers see the shared entry.
 */
export function getEntry(id: number): Promise<Entry> {
	return api<Entry>(`/api/entries/${id}`);
}

/**
 * getSharedEntry queries GET /api/entries/{id} without the bearer token,
 * so the response is the shared entry untouched by any user's overlay.
 * The editor uses it as the baseline for its patch: a field matching the
 * shared value is omitted, which the API reads as "no overlay here".
 */
export function getSharedEntry(id: number): Promise<EntryDetail> {
	return api<EntryDetail>(`/api/entries/${id}`, { auth: false });
}

/**
 * getCharsUnderRadical queries GET /api/entries/{id}/chars: the active
 * characters classified under the radical entry {id}, ordered by their
 * written form. A non-radical entry answers an empty list.
 */
export function getCharsUnderRadical(id: number): Promise<EntryBase[]> {
	return api<EntryBase[]>(`/api/entries/${id}/chars`, { auth: false });
}
