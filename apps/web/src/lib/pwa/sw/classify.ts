// The single gate of the service worker: what a request is, and so what the
// worker may do with it. Everything not named here is `bypass` (the worker
// does not touch it), so a new route is never cached by accident.

export type Kind = 'shell' | 'navigate' | 'hanzi' | 'api' | 'bypass';

export interface ReqLike {
	method: string;
	url: string;
	mode: string;
	headers: { get(name: string): string | null };
}

export interface ClassifyCtx {
	origin: string;
	/** Pathnames of the precached build files (`$service-worker` build + files). */
	shellUrls: ReadonlySet<string>;
}

/** normalizeUrl: path plus query with the keys sorted - the cache key of an API request. */
export function normalizeUrl(url: string): string {
	const parsed = new URL(url, 'https://x.invalid');
	const pairs = [...parsed.searchParams.entries()].sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
	if (pairs.length === 0) return parsed.pathname;
	return `${parsed.pathname}?${new URLSearchParams(pairs).toString()}`;
}

/**
 * The pull collections an offline copy may hold: the plugin rows and switches
 * and the typed study rows (docs/contracts/study/); never the dictionary.
 */
export const CACHEABLE_PULL_COLLECTIONS: readonly string[] = [
	'pluginData',
	'pluginStates',
	'cards',
	'decks',
	'deckSettings',
	'limits',
	'fsrsSets',
	'fsrsActive'
];
const PULL_COLLECTIONS = new Set(CACHEABLE_PULL_COLLECTIONS);
const SEGMENT = '[^/]+';
const API_PATTERNS: RegExp[] = [
	/^\/api\/auth\/me$/,
	/^\/api\/workspaces$/,
	/^\/api\/plugins$/,
	/^\/api\/languages$/,
	/^\/api\/me\/time-zone$/,
	new RegExp(`^/api/plugins/${SEGMENT}/data$`),
	new RegExp(`^/api/plugins/${SEGMENT}/data/${SEGMENT}$`),
	/^\/api\/entries\/[0-9]+$/
];

const CORE_DATA = '/api/plugins/qinqin-core/data';

/**
 * holdsLookups: a qinqin-core plugin data read that can return the lookup
 * history rows (`lookups`, `lookupcfg`, #72): the key route of such a key,
 * or a list whose prefix can match one. Never saved offline, so a Clear
 * leaves no copy in Cache Storage.
 */
export function holdsLookups(url: URL): boolean {
	const { searchParams } = url;
	let pathname: string;
	try {
		// An encoded path (qinqin%2Dcore, %6Cookups) names the same route.
		pathname = decodeURIComponent(url.pathname);
	} catch {
		return true;
	}
	if (pathname === CORE_DATA) {
		const p = searchParams.get('prefix') ?? '';
		return 'lookups'.startsWith(p) || 'lookupcfg'.startsWith(p) || p.startsWith('lookup');
	}
	if (!pathname.startsWith(`${CORE_DATA}/`)) return false;
	return pathname.slice(CORE_DATA.length + 1).startsWith('lookup');
}

/**
 * v2PullAllowed: a paged study pull is offline data when it is one workspace's
 * first page (collections a subset of the study set, optionally `tombstones=1`,
 * no `since`: a delta is not offline data) or a continuation (`page=p2.…`, the token carries its filters
 * and the server validates them; the URL is the cache key). Nothing else.
 */
function v2PullAllowed(params: URLSearchParams): boolean {
	if (params.getAll('v').join() !== '2') return false;
	const keys = [...params.keys()];
	if (keys.length !== new Set(keys).size) return false;
	if (params.has('page')) return keys.length === 2 && /^p2\.[A-Za-z0-9_-]+$/.test(params.get('page') ?? '');
	if (!keys.every((k) => ['v', 'collections', 'workspace', 'limit', 'tombstones'].includes(k))) return false;
	if (!/^[0-9]+$/.test(params.get('workspace') ?? '')) return false;
	if (params.has('limit') && !/^[0-9]+$/.test(params.get('limit') ?? '')) return false;
	if (params.has('tombstones') && params.get('tombstones') !== '1') return false;
	const list = (params.get('collections') ?? '').split(',');
	return list.every((c) => PULL_COLLECTIONS.has(c));
}

/** True when the path and query are one of the allowlisted API reads. */
function apiAllowed(url: URL): boolean {
	const { pathname, searchParams } = url;
	if (holdsLookups(url)) return false;
	if (API_PATTERNS.some((re) => re.test(pathname))) return true;
	if (pathname === '/api/sync/pull') {
		if (searchParams.has('v')) return v2PullAllowed(searchParams);
		// Without `collections` a pull is the whole dictionary delta: never stored.
		const all = searchParams.getAll('collections');
		if (all.length !== 1) return false;
		const list = all[0].split(',');
		return list.length > 0 && list.every((c) => PULL_COLLECTIONS.has(c));
	}
	if (pathname === '/api/events') return (searchParams.get('workspace') ?? '') !== '';
	return false;
}

const HANZI = /^\/hanzi\/U[0-9A-F]+\.json$/;

export function classify(req: ReqLike, ctx: ClassifyCtx): Kind {
	if (req.method !== 'GET') return 'bypass';
	let url: URL;
	try {
		url = new URL(req.url);
	} catch {
		return 'bypass';
	}
	if (url.origin !== ctx.origin) return 'bypass';
	const { pathname } = url;

	if (pathname.startsWith('/api/') || pathname === '/api') {
		// An API response is stored only for the credential that asked for it.
		if (req.mode === 'navigate' || !req.headers.get('authorization')) return 'bypass';
		return apiAllowed(url) ? 'api' : 'bypass';
	}
	if (req.mode === 'navigate') return 'navigate';
	if (HANZI.test(pathname)) return 'hanzi';
	if (
		ctx.shellUrls.has(pathname) ||
		pathname === '/' ||
		pathname === '/manifest.webmanifest' ||
		pathname === '/favicon.svg' ||
		pathname.startsWith('/icons/')
	) {
		return 'shell';
	}
	return 'bypass';
}
