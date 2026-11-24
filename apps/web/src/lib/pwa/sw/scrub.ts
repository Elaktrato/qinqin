// What a saved API copy may hold (#72): the lookup history never reaches
// Cache Storage. A whole-account pull keeps every row except the keyed
// `lookups` / `lookupcfg` rows, and an event log (the array or a
// page's `events`) every event except `lookup` events (older web clients stored search queries in them).
// Shared by the worker (before cache.put) and the page (scrubbing copies
// saved by an older worker). Pure.

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
	const row = r as { key?: unknown } | null;
	return typeof row?.key === 'string' && row.key.startsWith('lookup');
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
		const notLookup = (e: unknown) => (e as { type?: unknown } | null)?.type !== 'lookup';
		if (Array.isArray(body)) {
			const kept = body.filter(notLookup);
			return kept.length === body.length ? text : JSON.stringify(kept);
		}
		// A page of the paged form (#110): {events, more, next}.
		const page = body as { events?: unknown } | null;
		if (typeof page !== 'object' || page === null || !Array.isArray(page.events)) return null;
		const kept = page.events.filter(notLookup);
		return kept.length === page.events.length ? text : JSON.stringify({ ...page, events: kept });
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
	const pull = body as { collections?: unknown };
	// A v2 page keeps its rows under `collections` (docs/contracts/sync/).
	const paged = pull.collections;
	if (typeof paged !== 'object' || paged === null || Array.isArray(paged)) return text;
	const rows = (paged as { rows?: unknown }).rows;
	if (!Array.isArray(rows)) return text;
	const keptRows = rows.filter((r) => !isLookupRow(r));
	return keptRows.length === rows.length ? text : JSON.stringify({ ...pull, collections: { ...paged, rows: keptRows } });
}
