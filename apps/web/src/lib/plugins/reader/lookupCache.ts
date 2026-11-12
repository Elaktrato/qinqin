import { windowAt } from '$lib/api/segment';
import type { LookupResult } from '$lib/api/types';

/** The shape of lookupAt, injected so the lookup logic runs without a server. */
export type LookupFn = (
	lang: string,
	text: string,
	offset: number,
	kinds?: string[],
	signal?: AbortSignal
) => Promise<LookupResult[]>;

/**
 * cachedLookup wraps lookupAt with a small in-memory LRU keyed by language,
 * kinds and the window lookupAt would send: the results only depend on that
 * window, so hovering the same word again (anywhere) is free. Empty lists
 * are cached; failures and aborts are not.
 */
export function cachedLookup(inner: LookupFn, size = 300): LookupFn {
	const cache = new Map<string, LookupResult[]>();
	return async (lang, text, offset, kinds, signal) => {
		const window = windowAt(text, offset);
		if (window === null) return [];
		const key = `${lang}\u0000${(kinds ?? []).join(',')}\u0000${window}`;
		let results = cache.get(key);
		if (results) cache.delete(key);
		else results = await inner(lang, window, 0, kinds, signal);
		cache.set(key, results);
		if (cache.size > size) cache.delete(cache.keys().next().value as string);
		return results.map((r) => ({ ...r, start: r.start + offset, end: r.end + offset }));
	};
}
