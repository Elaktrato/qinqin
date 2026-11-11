import { api } from './client';
import type { Entry, EntryBase } from './types';

/**
 * getEntry queries GET /api/entries/{id}. With a stored bearer token the
 * API layers the caller's overlay on top of the shared entry; anonymous
 * callers see the shared entry.
 */
export function getEntry(id: number): Promise<Entry> {
	return api<Entry>(`/api/entries/${id}`);
}

/**
 * getCharsUnderRadical queries GET /api/entries/{id}/chars: the active
 * characters classified under the radical entry {id}, ordered by their
 * written form. A non-radical entry answers an empty list.
 */
export function getCharsUnderRadical(id: number): Promise<EntryBase[]> {
	return api<EntryBase[]>(`/api/entries/${id}/chars`, { auth: false });
}
