import { describe, expect, it } from 'vitest';
import routes from './routes.fixture.json';
import { classify, normalizeUrl, type ReqLike } from './classify';

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

	it('api: allowlisted GETs with Authorization', () => {
		for (const url of [
			'/api/auth/me',
			'/api/workspaces',
			'/api/plugins',
			'/api/languages',
			'/api/me/time-zone',
			'/api/sync/pull?cursor=1970-01-01T00:00:00Z&collections=pluginData,pluginStates',
			'/api/sync/pull?collections=pluginStates',
			'/api/plugins/qinqin-flashcards/data',
			'/api/plugins/qinqin-flashcards/data/vacation%3A01ABC',
			'/api/events?since=1970-01-01T00:00:00Z&workspace=3',
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

	it('api without Authorization is never classified api', () => {
		expect(kind('/api/workspaces', { auth: false })).toBe('bypass');
		expect(kind('/api/entries/12', { auth: false })).toBe('bypass');
	});

	it('the lookup history rows are never saved offline (#72)', () => {
		expect(kind('/api/plugins/qinqin-core/data/lookups?workspace=3')).toBe('bypass');
		expect(kind('/api/plugins/qinqin-core/data/lookupcfg')).toBe('bypass');
		expect(kind('/api/plugins/qinqin-core/data?workspace=3&prefix=lookups')).toBe('bypass');
		expect(kind('/api/plugins/qinqin-core/data?prefix=lookupcfg')).toBe('bypass');
		expect(kind('/api/plugins/qinqin-core/data?prefix=look')).toBe('bypass');
		expect(kind('/api/plugins/qinqin-core/data?workspace=3&prefix=note%3A')).toBe('api');
		expect(kind('/api/plugins/qinqin-core/data/note:5?workspace=3')).toBe('api');
		expect(kind('/api/plugins/qinqin-flashcards/data/lookups?workspace=3')).toBe('api');
		// an encoded path names the same route
		expect(kind('/api/plugins/qinqin%2Dcore/data/lookups?workspace=3')).toBe('bypass');
		expect(kind('/api/plugins/qinqin%2Dcore/data?workspace=3&prefix=lookups')).toBe('bypass');
		expect(kind('/api/plugins/qinqin-core/data/%6Cookups?workspace=3')).toBe('bypass');
	});

	it('access token management is never cached (the list, and create, which carries the token once)', () => {
		expect(kind('/api/account/tokens')).toBe('bypass');
		expect(kind('/api/account/tokens/4')).toBe('bypass');
		expect(kind('/api/account/tokens', { method: 'POST' })).toBe('bypass');
	});

	it('sync/pull only for the plugin collections', () => {
		expect(kind('/api/sync/pull?cursor=1970-01-01T00:00:00Z')).toBe('bypass');
		expect(kind('/api/sync/pull?collections=pluginData,lexicon')).toBe('bypass');
		expect(kind('/api/sync/pull?collections=')).toBe('bypass');
		expect(kind('/api/sync/pull?collections=pluginData&collections=entries')).toBe('bypass');
	});

	it('events need a workspace; entry sub-routes and lookalikes are bypass', () => {
		expect(kind('/api/events?since=1970-01-01T00:00:00Z')).toBe('bypass');
		expect(kind('/api/entries/12/chars')).toBe('bypass');
		expect(kind('/api/entries/bases')).toBe('bypass');
		expect(kind('/api/workspaces/3')).toBe('bypass');
		expect(kind('/api/plugins/x/data/a/b')).toBe('bypass');
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
		'GET /api/plugins',
		'GET /api/languages',
		'GET /api/me/time-zone',
		'GET /api/sync/pull',
		'GET /api/plugins/{id}/data',
		'GET /api/plugins/{id}/data/{key}',
		'GET /api/events',
		'GET /api/entries/{id}'
	]);

	function sample(pattern: string): string {
		const path = pattern.split(' ')[1]
			.replace('{id}', pattern.includes('/entries/') ? '12' : 'qinqin-flashcards')
			.replace('{key}', 'card%3A1')
			.replace(/\{[a-z]+\}/g, '1');
		return `${path}?collections=pluginData,pluginStates&workspace=3&since=1970-01-01T00:00:00Z`;
	}

	it('the opt-in list only names routes that exist', () => {
		const have = new Set(routes.map((r) => r.pattern));
		for (const pattern of CACHEABLE) expect(have.has(pattern), pattern).toBe(true);
	});

	for (const route of routes) {
		const expected = CACHEABLE.has(route.pattern) ? 'api' : 'bypass';
		it(`${route.pattern} -> ${expected}`, () => {
			const [method] = route.pattern.split(' ');
			expect(classify(req(sample(route.pattern), { method }), ctx)).toBe(expected);
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
