import { windowAt } from '$lib/api/segment';
import type { SegmentMatch } from '$lib/api/types';
import type { SegmentFn } from './selectionLookup';

/**
 * cachedSegment wraps a segment function with a small in-memory LRU keyed
 * by language and the window segmentAt would send: the match only depends
 * on that window, so hovering the same word again (anywhere) is free.
 * Misses (null) are cached; failures and aborts are not.
 */
export function cachedSegment(inner: SegmentFn, size = 300): SegmentFn {
	const cache = new Map<string, SegmentMatch | null>();
	return async (lang, text, offset, signal) => {
		const window = windowAt(text, offset);
		if (window === null) return null;
		const key = `${lang}\u0000${window}`;
		let match: SegmentMatch | null;
		if (cache.has(key)) {
			match = cache.get(key) ?? null;
			cache.delete(key);
		} else {
			match = await inner(lang, window, 0, signal);
		}
		cache.set(key, match);
		if (cache.size > size) cache.delete(cache.keys().next().value as string);
		return match && { ...match, start: match.start + offset, end: match.end + offset };
	};
}
