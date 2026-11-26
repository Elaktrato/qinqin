
/**
 * Self-hosted stroke-order data. The server serves the installed strokes
 * package under /hanzi/ with codepoint names (U597D.json, upper-case hex), so
 * the URL is computed rather than shipped as a map. It is not in the web bundle.
 */
import type { StrokeCache } from '../context/caches';

/**
 * usableLang is the language code the route accepts (two or three lower-case letters), else null: a profile
 * code with a region ("zh-TW") or an empty one asks for no particular language.
 */
function usableLang(lang: string | undefined): string | null {
	return lang !== undefined && /^[a-z]{2,3}$/.test(lang) ? lang : null;
}

/**
 * strokeUrl is the URL of one character's stroke data. With a language the server prefers the pack made for it
 * (Japanese shapes differ from Chinese ones for the same code point; docs/contracts/strokes).
 */
export function strokeUrl(ch: string, lang?: string): string {
	const codepoint = ch.codePointAt(0);
	if (codepoint === undefined) throw new Error('strokeUrl needs a character');
	const base = `/hanzi/U${codepoint.toString(16).toUpperCase()}.json`;
	const code = usableLang(lang);
	return code === null ? base : `${base}?lang=${code}`;
}

/**
 * StrokeResult says why there is no data: `missing` is definitive (404 or
 * unreadable JSON, the character has no stroke data), `error` is transient
 * (offline, server error) and worth a retry.
 */
export type StrokeResult = { kind: 'ok'; data: unknown } | { kind: 'missing' } | { kind: 'error' };

// One promise per character and language; ok and missing results are cached so a known
// character is not refetched on every render. Transient errors are not.

export function fetchStrokeData(cache: StrokeCache, ch: string, fetchFn: typeof fetch = fetch, lang?: string): Promise<StrokeResult> {
	const key = `${usableLang(lang) ?? ''}|${ch}`;
	const hit = cache.cache.get(key);
	if (hit) return hit;
	const pending = (async (): Promise<StrokeResult> => {
		let response: Response;
		try {
			response = await fetchFn(strokeUrl(ch, lang));
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
	cache.cache.set(key, pending);
	void pending.then((result) => {
		if (result.kind === 'error' && cache.cache.get(key) === pending) cache.cache.delete(key);
	});
	return pending;
}

export async function loadStrokeData(
	cache: StrokeCache,
	ch: string,
	fetchFn: typeof fetch = fetch,
	lang?: string
): Promise<unknown | null> {
	const result = await fetchStrokeData(cache, ch, fetchFn, lang);
	return result.kind === 'ok' ? result.data : null;
}
