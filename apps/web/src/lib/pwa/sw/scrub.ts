// What a saved API copy may hold (#72): the lookup history never reaches
// Cache Storage. A whole-account pull keeps every row except the
// qinqin-core `lookups` / `lookupcfg` rows, and an event log every event
// except `lookup` events (older web clients stored search queries in them).
// Shared by the worker (before cache.put) and the page (scrubbing copies
// saved by an older worker). Pure.

const CORE = 'qinqin-core';

function decodedPath(pathname: string): string | null {
	try {
		return decodeURIComponent(pathname);
	} catch {
		return null;
	}
}

/** scrubbed: the paths whose saved copies are filtered. */
export function scrubbedPath(pathname: string): boolean {
	const path = decodedPath(pathname);
	return path === null || path === '/api/sync/pull' || path === '/api/events';
}

const isLookupRow = (r: unknown): boolean => {
	const row = r as { pluginId?: unknown; key?: unknown } | null;
	return row?.pluginId === CORE && typeof row.key === 'string' && row.key.startsWith('lookup');
};

/**
 * scrubForCache returns the body to save for a response of `pathname`: the
 * same text for every other path, the filtered JSON for a pull or an event
 * log, and null when such a body cannot be read (then nothing is saved).
 */
export function scrubForCache(pathname: string, text: string): string | null {
	const path = decodedPath(pathname);
	if (path === null) return null;
	if (path !== '/api/sync/pull' && path !== '/api/events') return text;
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return null;
	}
	if (path === '/api/events') {
		if (!Array.isArray(body)) return null;
		const kept = body.filter((e) => (e as { type?: unknown } | null)?.type !== 'lookup');
		return kept.length === body.length ? text : JSON.stringify(kept);
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
	const pull = body as { pluginData?: unknown };
	if (!Array.isArray(pull.pluginData)) return text;
	const kept = pull.pluginData.filter((r) => !isLookupRow(r));
	return kept.length === pull.pluginData.length ? text : JSON.stringify({ ...pull, pluginData: kept });
}
