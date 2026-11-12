import { api } from './client';
import { windowAt } from './segment';
import type { LookupResult } from './types';

/**
 * LOOKUP_WINDOW is the longest text, in code points, the server's lookup
 * engine reads from the offset. It must equal lookup.MaxWindowRunes in
 * server/internal/lookup/lookup.go: the client sends and caches exactly
 * that window, so texts that differ only past it share one lookup.
 */
export const LOOKUP_WINDOW = 12;

/**
 * lookupAt returns the dictionary results for the text starting at the
 * code-point `offset` of `text`, with start/end translated back to the
 * original text's offsets. Only a short window is sent (offset 0 on the
 * server) so the GET URL stays small. Resolves to [] without a request when
 * the offset is out of range.
 */
export async function lookupAt(
	lang: string,
	text: string,
	offset: number,
	kinds?: string[],
	signal?: AbortSignal
): Promise<LookupResult[]> {
	const window = windowAt(text, offset, LOOKUP_WINDOW);
	if (window === null) return [];
	const query = new URLSearchParams({ lang, text: window, offset: '0' });
	for (const kind of kinds ?? []) query.append('kind', kind);
	const body = await api<{ results?: LookupResult[] | null }>(`/api/lookup?${query}`, { signal });
	return (body?.results ?? []).map((r) => ({
		...r,
		forms: r.forms ?? [],
		readings: r.readings ?? [],
		reasons: r.reasons ?? [],
		tags: r.tags ?? [],
		frequencies: r.frequencies ?? [],
		senses: r.senses ?? [],
		start: r.start + offset,
		end: r.end + offset
	}));
}
