import { api } from './client';
import type { Entry, EntryBase, EntryDetail, Sentence, SentenceSourceRequest } from './types';

/** The URL of one entry; offline preparation requests exactly the same string. */
export function entryPath(id: number): string {
	return `/api/entries/${id}`;
}

/**
 * getEntry queries GET /api/entries/{id}. With a stored bearer token the
 * API layers the caller's overlay on top of the shared entry; anonymous
 * callers see the shared entry.
 */
export function getEntry(id: number): Promise<Entry> {
	return api<Entry>(entryPath(id));
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

/**
 * addSentence stores the caller's own example sentence on the entry
 * (POST /api/entries/{id}/sentences) with only its text; reading and
 * translation stay empty. `source` is where the reader met it (#280). The
 * response is the stored sentence (an existing one with the same text: 200).
 */
export function addSentence(entryId: number, hanzi: string, source?: SentenceSourceRequest): Promise<Sentence> {
	return api<Sentence>(`/api/entries/${entryId}/sentences`, { method: 'POST', body: source ? { hanzi, source } : { hanzi } });
}

/**
 * removeSentence deletes one of the caller's own sentences of the entry
 * (DELETE /api/entries/{id}/sentences/{sentenceId}, #279): a saved book
 * sentence or a kept AI example. Pack sentences are 404.
 */
export async function removeSentence(entryId: number, sentenceId: number): Promise<void> {
	await api<void>(`/api/entries/${entryId}/sentences/${sentenceId}`, { method: 'DELETE' });
}
