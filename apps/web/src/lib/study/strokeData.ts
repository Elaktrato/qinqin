
/**
 * Self-hosted stroke-order data. The server serves the installed strokes
 * package under /hanzi/ with codepoint names (U597D.json, upper-case hex), so
 * the URL is computed rather than shipped as a map. It is not in the web bundle.
 */
import type { StrokeCache } from '../context/caches';

export function strokeUrl(ch: string): string {
	const codepoint = ch.codePointAt(0);
	if (codepoint === undefined) throw new Error('strokeUrl needs a character');
	return `/hanzi/U${codepoint.toString(16).toUpperCase()}.json`;
}

/**
 * StrokeResult says why there is no data: `missing` is definitive (404 or
 * unreadable JSON, the character has no stroke data), `error` is transient
 * (offline, server error) and worth a retry.
 */
export type StrokeResult = { kind: 'ok'; data: unknown } | { kind: 'missing' } | { kind: 'error' };

// One promise per character; ok and missing results are cached so a known
// character is not refetched on every render. Transient errors are not.

export function fetchStrokeData(cache: StrokeCache, ch: string, fetchFn: typeof fetch = fetch): Promise<StrokeResult> {
	const hit = cache.cache.get(ch);
	if (hit) return hit;
	const pending = (async (): Promise<StrokeResult> => {
		let response: Response;
		try {
			response = await fetchFn(strokeUrl(ch));
		} catch {
			return { kind: 'error' };
		}
		if (response.status === 404) return { kind: 'missing' };
		if (!response.ok) return { kind: 'error' };
		try {
			return { kind: 'ok', data: (await response.json()) as unknown };
		} catch {
			return { kind: 'missing' };
		}
	})();
	cache.cache.set(ch, pending);
	void pending.then((result) => {
		if (result.kind === 'error' && cache.cache.get(ch) === pending) cache.cache.delete(ch);
	});
	return pending;
}

export async function loadStrokeData(
	cache: StrokeCache,
	ch: string,
	fetchFn: typeof fetch = fetch
): Promise<unknown | null> {
	const result = await fetchStrokeData(cache, ch, fetchFn);
	return result.kind === 'ok' ? result.data : null;
}
