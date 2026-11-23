// Paged pull client (GET /api/sync/pull?v=2), docs/contracts/sync/. A round is
// a first page (scope set) followed by `next` pages until `more` is false; the
// last page carries the cursor for the next round. The pager checks the page
// envelope only and refuses a page whose envelope does not match the contract;
// it never inspects a row. Rows are the consumer's to decode (./rows.ts
// readableRow, the typed study decode): an unreadable row is skipped by the
// consumer and never blocks the round (docs/contracts/sync/, "Reading rows").

export const V2_STUDY_COLLECTIONS: readonly string[] = [
	'pluginStates',
	'pluginData',
	'cards',
	'decks',
	'deckSettings',
	'limits',
	'fsrsSets',
	'fsrsActive'
];

export interface PullScope {
	workspaces: { id: number; language: string }[];
	languages: string[];
	catalogue: string;
}

export interface PullPage {
	format: 2;
	instanceId: string;
	until: string;
	scope: PullScope | null;
	restarted: string[];
	collections: Record<string, unknown[]>;
	more: boolean;
	next: string | null;
	cursor: string | null;
}

const RESTARTABLE = new Set(['overlays', 'sentences']);
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && TIME.test(v);
const sameKeys = (o: Record<string, unknown>, keys: readonly string[]) => {
	const have = Object.keys(o);
	return have.length === keys.length && keys.every((k) => k in o);
};

function scopeOk(raw: unknown): raw is PullScope {
	if (!isRecord(raw) || !sameKeys(raw, ['workspaces', 'languages', 'catalogue'])) return false;
	const { workspaces, languages, catalogue } = raw;
	if (typeof catalogue !== 'string' || !Array.isArray(workspaces) || !Array.isArray(languages)) return false;
	let prev = -Infinity;
	for (const w of workspaces) {
		if (!isRecord(w) || !sameKeys(w, ['id', 'language']) || !Number.isInteger(w.id) || typeof w.language !== 'string') return false;
		if ((w.id as number) <= prev) return false;
		prev = w.id as number;
	}
	for (let i = 0; i < languages.length; i++) {
		if (typeof languages[i] !== 'string') return false;
		if (i > 0 && !((languages[i - 1] as string) < (languages[i] as string))) return false;
	}
	return true;
}

/**
 * parsePullPage checks the envelope of one v2 answer for the requested collection
 * set (every collection an array; rows not inspected), or null if it is off.
 */
export function parsePullPage(raw: unknown, requested: readonly string[]): PullPage | null {
	if (!isRecord(raw) || !sameKeys(raw, ['format', 'instanceId', 'until', 'scope', 'restarted', 'collections', 'more', 'next', 'cursor'])) return null;
	if (raw.format !== 2 || typeof raw.instanceId !== 'string' || !ULID.test(raw.instanceId) || !isTime(raw.until)) return null;
	if (raw.scope !== null && !scopeOk(raw.scope)) return null;
	const restarted = raw.restarted;
	if (!Array.isArray(restarted) || !restarted.every((r) => typeof r === 'string' && RESTARTABLE.has(r))) return null;
	const cols = raw.collections;
	if (!isRecord(cols) || Object.keys(cols).length !== requested.length) return null;
	for (const name of requested) {
		const rows = cols[name];
		if (!Array.isArray(rows)) return null;
	}
	const { more, next, cursor } = raw;
	if (typeof more !== 'boolean') return null;
	if (more) {
		if (typeof next !== 'string' || !next.startsWith('p2.') || cursor !== null) return null;
	} else if (next !== null || typeof cursor !== 'string' || !cursor.startsWith('c2.')) {
		return null;
	}
	return raw as unknown as PullPage;
}

const PATH = '/api/sync/pull';

function build(pairs: [string, string][]): string {
	pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); // as normalizeUrl sorts: a stable worker cache key
	return `${PATH}?${new URLSearchParams(pairs).toString()}`;
}

/**
 * firstPageUrl: the request that opens a round (no collections = every collection).
 * tombstones asks a round from no since for tombstones too (a client that stamps
 * its writes after the server's times needs them); the cursor binds it.
 */
export function firstPageUrl(opts: {
	collections: readonly string[];
	workspace?: number;
	since?: string;
	limit?: number;
	tombstones?: boolean;
}): string {
	const pairs: [string, string][] = [['v', '2']];
	if (opts.collections.length > 0) pairs.push(['collections', opts.collections.join(',')]);
	if (opts.workspace !== undefined) pairs.push(['workspace', String(opts.workspace)]);
	if (opts.tombstones === true) pairs.push(['tombstones', '1']);
	if (opts.since !== undefined) pairs.push(['since', opts.since]);
	if (opts.limit !== undefined) pairs.push(['limit', String(opts.limit)]);
	return build(pairs);
}

/** nextPageUrl: a continuation carries the token and nothing else. */
export function nextPageUrl(next: string): string {
	return build([['v', '2'], ['page', next]]);
}

/** pullAll follows a round to its last page and merges the rows in page order. */
export async function pullAll(
	get: (path: string) => Promise<unknown>,
	first: string,
	requested: readonly string[],
	opts: { maxPages?: number } = {}
): Promise<{ collections: Record<string, unknown[]>; scope: PullScope; cursor: string; instanceId: string; restarted: string[]; pages: number }> {
	const maxPages = opts.maxPages ?? 1000;
	const collections: Record<string, unknown[]> = Object.fromEntries(requested.map((n) => [n, []]));
	let scope: PullScope | null = null;
	let instanceId = '';
	let restarted: string[] = [];
	let path = first;
	for (let n = 1; ; n++) {
		if (n > maxPages) throw new Error(`sync pull: more than ${maxPages} pages (maxPages)`);
		const page = parsePullPage(await get(path), requested);
		if (page === null) throw new Error('sync pull: a page does not match the contract');
		if (n === 1) {
			if (page.scope === null) throw new Error('sync pull: the first page has no scope');
			scope = page.scope;
			instanceId = page.instanceId;
		} else if (page.instanceId !== instanceId) {
			throw new Error('sync pull: the server instance changed mid-round');
		}
		restarted = [...new Set([...restarted, ...page.restarted])];
		for (const name of requested) collections[name].push(...page.collections[name]);
		if (!page.more) return { collections, scope: scope as PullScope, cursor: page.cursor as string, instanceId, restarted, pages: n };
		path = nextPageUrl(page.next as string);
	}
}
