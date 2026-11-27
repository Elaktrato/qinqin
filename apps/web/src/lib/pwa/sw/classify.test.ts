import { describe, expect, it } from 'vitest';
import routes from './routes.fixture.json';
import { CACHEABLE_PULL_COLLECTIONS, classify, normalizeUrl, type ReqLike } from './classify';
import { STUDY_COLLECTIONS } from '$lib/studycore/rows';

const ORIGIN = 'https://qinqin.example';
const ctx = { origin: ORIGIN, shellUrls: new Set(['/_app/immutable/entry/start.abc.js', '/_app/version.json']) };

function req(url: string, init: { method?: string; mode?: string; auth?: boolean } = {}): ReqLike {
	return {
		method: init.method ?? 'GET',
		url: url.startsWith('http') ? url : ORIGIN + url,
		mode: init.mode ?? 'cors',
		headers: { get: (name: string) => (name.toLowerCase() === 'authorization' && init.auth !== false ? 'Bearer t' : null) }
	};
}

describe('normalizeUrl', () => {
	it('sorts query keys and drops the origin', () => {
		expect(normalizeUrl(`${ORIGIN}/api/events?workspace=2&since=1970-01-01T00:00:00Z`)).toBe(
			normalizeUrl(`${ORIGIN}/api/events?since=1970-01-01T00:00:00Z&workspace=2`)
		);
		expect(normalizeUrl(`${ORIGIN}/api/x`)).toBe('/api/x');
	});
});

describe('classify: spec table', () => {
	const kind = (url: string, init?: Parameters<typeof req>[1]) => classify(req(url, init), ctx);

	it('shell: build files, icons, manifest', () => {
		expect(kind('/_app/immutable/entry/start.abc.js')).toBe('shell');
		expect(kind('/manifest.webmanifest')).toBe('shell');
		expect(kind('/icons/icon-192.png')).toBe('shell');
		expect(kind('/favicon.svg')).toBe('shell');
	});

	it('navigations are navigate, also for /', () => {
		expect(kind('/study', { mode: 'navigate' })).toBe('navigate');
		expect(kind('/', { mode: 'navigate' })).toBe('navigate');
	});

	it('a navigation to an API path is bypass', () => {
		expect(kind('/api/workspaces', { mode: 'navigate' })).toBe('bypass');
	});

	it('hanzi data is cache-first on demand; look-alikes are bypass', () => {
		expect(kind('/hanzi/U732B.json', { auth: false })).toBe('hanzi');
		expect(kind('/hanzi/U732B.json.map')).toBe('bypass');
		expect(kind('/hanzi/../api/x')).toBe('bypass');
		expect(kind('/hanzi/UZZ.json')).toBe('bypass');
	});

	it('font slices are cache-first on demand, with or without a credential; look-alikes are bypass', () => {
		const sha = 'ab'.repeat(32);
		expect(kind(`/fonts/${sha}.woff2`, { auth: false })).toBe('font');
		expect(kind(`/fonts/${sha}.woff2`)).toBe('font');
		expect(kind(`/fonts/${sha}.woff2`, { method: 'HEAD' })).toBe('bypass');
		expect(kind(`/fonts/${sha.toUpperCase()}.woff2`)).toBe('bypass');
		expect(kind(`/fonts/${sha}.woff`)).toBe('bypass');
		expect(kind(`/fonts/${sha.slice(2)}.woff2`)).toBe('bypass');
		expect(kind('/fonts/../api/x.woff2')).toBe('bypass');
		expect(kind(`https://evil.example/fonts/${sha}.woff2`)).toBe('bypass');
		expect(kind(`/fonts/${sha}.woff2`, { mode: 'navigate' })).toBe('navigate');
	});

	it('the faces list is an API read kept per credential (offline: the pack faces stay registered)', () => {
		expect(kind('/api/fonts')).toBe('api');
		expect(kind('/api/fonts', { auth: false })).toBe('bypass');
	});

	it('push and reminder routes are never cached, with or without a credential (#139)', () => {
		for (const url of [
			'/api/push/vapid-key',
			'/api/push/subscriptions',
			'/api/push/subscriptions/7',
			'/api/reminders/plan?days=7',
			'/api/reminders/facts',
			'/api/reminders/test',
			'/api/reminders/unsubscribe?t=x'
		]) {
			expect(kind(url), url).toBe('bypass');
			expect(kind(url, { auth: false }), url).toBe('bypass');
			expect(kind(url, { method: 'PUT' }), url).toBe('bypass');
		}
	});

	it('api: allowlisted GETs with Authorization', () => {
		for (const url of [
			'/api/auth/me',
			'/api/workspaces',
			'/api/features',
			'/api/languages',
			'/api/me/time-zone',
			'/api/rows?workspace=3&prefix=note%3A',
			'/api/rows/vacation%3A01ABC',
			'/api/events?since=1970-01-01T00:00:00Z&workspace=3',
			'/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=3',
			'/api/events?page=e1.eyJ1IjozfQ&workspace=3',
			'/api/events?workspace=3&page=e1.abc_-',
			'/api/entries/12'
		]) {
			expect(kind(url), url).toBe('api');
		}
	});

	it('the radical lookup data is never cached offline (decision: bypass)', () => {
		for (const url of ['/api/components?language=ja', '/api/component-packs', '/api/characters?language=ja']) {
			expect(kind(url), url).toBe('bypass');
			expect(kind(url, { auth: false }), url).toBe('bypass');
		}
	});

	it('stroke files are a server route now and stay hanzi; the stroke pack list is bypass', () => {
		expect(routes.some((r) => r.pattern === 'GET /hanzi/{file}' && r.access === 'public')).toBe(true);
		expect(kind('/hanzi/U597D.json', { auth: false })).toBe('hanzi');
		expect(kind('/api/stroke-packs')).toBe('bypass');
		expect(kind('/api/stroke-packs', { auth: false })).toBe('bypass');
	});

	it('data packages are never cached by the worker (decision: bypass; the client stores the files itself)', () => {
		for (const url of ['/api/packages', '/api/packages?languages=all', '/api/packages/lexicon.zh/3']) {
			expect(kind(url), url).toBe('bypass');
			expect(kind(url, { method: 'GET', mode: 'cors' }), url).toBe('bypass');
		}
	});

	it('api without Authorization is never classified api', () => {
		expect(kind('/api/workspaces', { auth: false })).toBe('bypass');
		expect(kind('/api/entries/12', { auth: false })).toBe('bypass');
	});

	it('the lookup history rows are never saved offline (#72)', () => {
		expect(kind('/api/rows/lookups?workspace=3')).toBe('bypass');
		expect(kind('/api/rows/lookupcfg')).toBe('bypass');
		expect(kind('/api/rows?workspace=3&prefix=lookups')).toBe('bypass');
		expect(kind('/api/rows?prefix=lookupcfg')).toBe('bypass');
		expect(kind('/api/rows?prefix=look')).toBe('bypass');
		expect(kind('/api/rows?workspace=3&prefix=note%3A')).toBe('api');
		expect(kind('/api/rows/note:5?workspace=3')).toBe('api');
		// a list without a prefix can hold the lookup rows
		expect(kind('/api/rows?workspace=3')).toBe('bypass');
		expect(kind('/api/rows')).toBe('bypass');
		// an encoded path names the same route
		expect(kind('/api/%72ows/lookups?workspace=3')).toBe('bypass');
		expect(kind('/api/%72ows?workspace=3&prefix=lookups')).toBe('bypass');
		expect(kind('/api/rows/%6Cookups?workspace=3')).toBe('bypass');
	});

	it('access token management is never cached (the list, and create, which carries the token once)', () => {
		expect(kind('/api/account/tokens')).toBe('bypass');
		expect(kind('/api/account/tokens/4')).toBe('bypass');
		expect(kind('/api/account/tokens', { method: 'POST' })).toBe('bypass');
	});

	// #198: the legacy pull (no v=2) is gone; the server answers 404, and no copy is kept.
	it('a sync/pull without v=2 is never cached', () => {
		for (const url of [
			'/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=rows,cards,decks,deckSettings,limits,fsrsSets,fsrsActive',
			'/api/sync/pull?collections=cards',
			'/api/sync/pull?collections=fsrsActive,rows',
			'/api/sync/pull?collections=rows',
			'/api/sync/pull?collections=pluginStates',
			'/api/sync/pull'
		]) {
			expect(kind(url), url).toBe('bypass');
		}
	});

	it('a v2 study page is cacheable: first page with workspace and a study subset, and a p2 continuation', () => {
		const study = 'rows,cards,decks,deckSettings,limits,fsrsSets,fsrsActive';
		for (const url of [
			`/api/sync/pull?collections=${study}&v=2&workspace=3`,
			`/api/sync/pull?collections=${study}&tombstones=1&v=2&workspace=3`, // the web study pull
			`/api/sync/pull?collections=cards&limit=100&v=2&workspace=3`,
			'/api/sync/pull?collections=rows&v=2&workspace=12',
			'/api/sync/pull?page=p2.abcDEF-_123&v=2'
		]) {
			expect(kind(url), url).toBe('api');
		}
	});

	it('a v2 pull outside the study set is not cacheable', () => {
		for (const url of [
			'/api/sync/pull?collections=cards&v=2', // no workspace
			'/api/sync/pull?v=2&workspace=3', // no collections: the whole account
			'/api/sync/pull?collections=cards,events&v=2&workspace=3',
			'/api/sync/pull?collections=overlays&v=2&workspace=3',
			'/api/sync/pull?collections=books&v=2&workspace=3',
			'/api/sync/pull?collections=cards,entries&v=2&workspace=3',
			'/api/sync/pull?collections=cards&since=2026-01-01T00:00:00Z&v=2&workspace=3', // deltas are not offline data
			'/api/sync/pull?collections=cards&v=2&workspace=x',
			'/api/sync/pull?collections=cards&limit=x&v=2&workspace=3',
			'/api/sync/pull?collections=cards&v=3&workspace=3',
			'/api/sync/pull?page=c2.abc&v=2', // a cursor is not a page
			'/api/sync/pull?page=&v=2',
			'/api/sync/pull?page=p2.abc&v=2&collections=events', // a continuation carries nothing else
			'/api/sync/pull?page=p2.abc',
			'/api/sync/pull?collections=cards&tombstones=0&v=2&workspace=3',
			'/api/sync/pull?collections=cards&tombstones=1&tombstones=1&v=2&workspace=3',
			'/api/sync/pull?collections=cards&since=c2.x&tombstones=1&v=2&workspace=3', // still a delta
			'/api/sync/pull?page=p2.abc&tombstones=1&v=2'
		]) {
			expect(kind(url), url).toBe('bypass');
		}
		expect(kind('/api/sync/pull?collections=cards&v=2&workspace=3', { auth: false }), 'no Authorization').toBe('bypass');
	});

	it('the cacheable pull collections are the keyed rows and every typed study collection', () => {
		expect(CACHEABLE_PULL_COLLECTIONS).toEqual(['rows', ...STUDY_COLLECTIONS]);
	});

	it('sync/pull only for the plugin collections', () => {
		expect(kind('/api/sync/pull?cursor=1970-01-01T00:00:00Z')).toBe('bypass');
		expect(kind('/api/sync/pull?collections=rows,lexicon')).toBe('bypass');
		expect(kind('/api/sync/pull?collections=')).toBe('bypass');
		expect(kind('/api/sync/pull?collections=rows&collections=entries')).toBe('bypass');
	});

	it('events need a workspace; entry sub-routes and lookalikes are bypass', () => {
		expect(kind('/api/events?since=1970-01-01T00:00:00Z')).toBe('bypass');
		expect(kind('/api/events?limit=2000')).toBe('bypass');
		// A continuation (#110): exactly page=e1.<token> and the workspace.
		expect(kind('/api/events?page=e1.abc')).toBe('bypass');
		expect(kind('/api/events?page=e1.abc&workspace=3&since=1970-01-01T00:00:00Z')).toBe('bypass');
		expect(kind('/api/events?page=e1.abc&workspace=3&limit=5')).toBe('bypass');
		expect(kind('/api/events?page=p2.abc&workspace=3')).toBe('bypass');
		expect(kind('/api/events?page=e1.a%2Fb&workspace=3')).toBe('bypass');
		expect(kind('/api/events?page=&workspace=3')).toBe('bypass');
		expect(kind('/api/events?page=e1.a&page=e1.b&workspace=3')).toBe('bypass');
		expect(kind('/api/events?page=e1.a&workspace=x')).toBe('bypass');
		expect(kind('/api/entries/12/chars')).toBe('bypass');
		expect(kind('/api/entries/bases')).toBe('bypass');
		expect(kind('/api/workspaces/3')).toBe('bypass');
		expect(kind('/api/rows/a/b')).toBe('bypass');
		expect(kind('/api/auth/me/../logout')).toBe('bypass');
	});

	it('everything else is bypass: non-GET, other origins, unknown paths', () => {
		expect(kind('/api/workspaces', { method: 'POST' })).toBe('bypass');
		expect(kind('/api/events/batch', { method: 'POST' })).toBe('bypass');
		expect(kind('https://evil.example/api/workspaces')).toBe('bypass');
		expect(kind('/service-worker.js')).toBe('bypass');
		expect(kind('/ANTHROPIC-SDK-GO-LICENSE.TXT')).toBe('bypass');
		expect(kind('/some/asset.png')).toBe('bypass');
	});
});

// Every real route, from the server's route table (a Go test keeps the
// fixture equal to routes()): only the opted-in GETs may be cached.
describe('classify: the server route table', () => {
	const CACHEABLE = new Set([
		'GET /api/auth/me',
		'GET /api/workspaces',
		'GET /api/features',
		'GET /api/languages',
		'GET /api/me/time-zone',
		'GET /api/sync/pull',
		'GET /api/rows',
		'GET /api/rows/{key}',
		'GET /api/events',
		'GET /api/entries/{id}',
		'GET /api/themes',
		'GET /api/fonts'
	]);

	function sample(pattern: string): string {
		if (pattern === 'GET /api/sync/pull') return '/api/sync/pull?v=2&collections=rows&workspace=3';
		if (pattern === 'GET /api/rows') return '/api/rows?workspace=3&prefix=note%3A';
		const path = pattern.split(' ')[1]
			.replace('{id}', pattern.includes('/entries/') ? '12' : 'qinqin-flashcards')
			.replace('{key}', 'note%3A1')
			.replace(/\{[a-z]+\}/g, '1');
		return `${path}?collections=rows&workspace=3&since=1970-01-01T00:00:00Z`;
	}

	it('the opt-in list only names routes that exist', () => {
		const have = new Set(routes.map((r) => r.pattern));
		for (const pattern of CACHEABLE) expect(have.has(pattern), pattern).toBe(true);
	});

	/** Public file routes the worker keeps on demand, with the kind and a real file name. */
	const FILES: Record<string, { kind: string; path: string }> = {
		'GET /hanzi/{file}': { kind: 'hanzi', path: '/hanzi/U597D.json' },
		'GET /fonts/{file}': { kind: 'font', path: `/fonts/${'0f'.repeat(32)}.woff2` }
	};

	for (const route of routes) {
		const file = FILES[route.pattern];
		const expected = file ? file.kind : CACHEABLE.has(route.pattern) ? 'api' : 'bypass';
		it(`${route.pattern} -> ${expected}`, () => {
			const [method] = route.pattern.split(' ');
			expect(classify(req(file ? file.path : sample(route.pattern), { method }), ctx)).toBe(expected);
		});
	}

	it('no admin, account, AI, journal-photo, audio or lookup GET is ever cacheable', () => {
		for (const route of routes) {
			if (/\/api\/(admin|account|ai|journal|audio|lookup|search|segment|auth\/(?!me$))/.test(route.pattern)) {
				expect(CACHEABLE.has(route.pattern), route.pattern).toBe(false);
			}
		}
	});
});
