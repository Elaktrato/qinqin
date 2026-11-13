/**
 * Self-hosted stroke-order data. The prebuild step copies hanzi-writer-data
 * into static/hanzi under codepoint names (U597D.json, upper-case hex), so
 * the URL is computed rather than shipped as a map.
 */
export function strokeUrl(ch: string): string {
	const codepoint = ch.codePointAt(0);
	if (codepoint === undefined) throw new Error('strokeUrl needs a character');
	return `/hanzi/U${codepoint.toString(16).toUpperCase()}.json`;
}

// One promise per character; null results (404, network, bad JSON) are cached
// too so a missing character is not refetched on every render.
const cache = new Map<string, Promise<unknown | null>>();

export function resetStrokeDataCache(): void {
	cache.clear();
}

export function loadStrokeData(ch: string, fetchFn: typeof fetch = fetch): Promise<unknown | null> {
	const hit = cache.get(ch);
	if (hit) return hit;
	const pending = (async () => {
		let response: Response;
		try {
			response = await fetchFn(strokeUrl(ch));
		} catch {
			// Transient: do not cache, so the next call retries.
			cache.delete(ch);
			return null;
		}
		// Definitive negatives (404, invalid JSON) stay cached.
		if (!response.ok) return null;
		try {
			return (await response.json()) as unknown;
		} catch {
			return null;
		}
	})();
	cache.set(ch, pending);
	return pending;
}
