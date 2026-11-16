import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from '../../testing/fakeCaches';
import { classify } from './classify';
import { HANZI_CACHE, HANZI_CAP, OFFLINE_HEADER, SAVED_AT_HEADER, handleFetch, type Deps } from './strategies';
import { partitionName } from './partition';

const ORIGIN = 'https://qinqin.example';
const SHELL = 'qinqin-shell-v1';
const shellUrls = new Set(['/_app/immutable/a.js']);

function request(path: string, init: { auth?: string; mode?: string } = {}): Request {
	const headers: Record<string, string> = {};
	if (init.auth) headers.authorization = init.auth;
	const req = new Request(ORIGIN + path, { headers });
	if (init.mode === 'navigate') Object.defineProperty(req, 'mode', { value: 'navigate' });
	return req;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let caches: FakeCacheStorage;
let fetchMock: ReturnType<typeof vi.fn>;
let now = Date.parse('2026-11-16T14:02:00Z');

function deps(): Deps {
	return {
		caches,
		fetch: fetchMock as unknown as Deps['fetch'],
		digest: (auth) => partitionName(auth),
		now: () => now,
		shellCache: SHELL,
		origin: ORIGIN,
		timeouts: { navigate: 4000, api: 8000 }
	};
}

async function run(req: Request): Promise<Response> {
	const kind = classify(req, { origin: ORIGIN, shellUrls });
	expect(kind).not.toBe('bypass');
	return handleFetch(kind as Exclude<typeof kind, 'bypass'>, req, deps());
}

beforeEach(() => {
	caches = new FakeCacheStorage();
	fetchMock = vi.fn();
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => vi.useRealTimers());

describe('api: network-first, partitioned by credential', () => {
	const URL1 = '/api/workspaces';

	it('stores a 200 in the partition of the requesting credential and returns it', async () => {
		fetchMock.mockResolvedValue(json([{ id: 1 }]));
		const res = await run(request(URL1, { auth: 'Bearer a' }));
		expect(res.status).toBe(200);
		expect(res.headers.get(OFFLINE_HEADER)).toBeNull();
		expect(await res.json()).toEqual([{ id: 1 }]);
		const name = await partitionName('Bearer a');
		expect([...(await caches.keys())]).toEqual([name]);
		expect((await caches.open(name)).entries.size).toBe(1);
	});

	it('serves the saved copy on a network error, marked offline with its save time', async () => {
		fetchMock.mockResolvedValueOnce(json([{ id: 1 }]));
		await run(request(URL1, { auth: 'Bearer a' }));
		fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		now += 60_000;
		const res = await run(request(URL1, { auth: 'Bearer a' }));
		expect(res.status).toBe(200);
		expect(res.headers.get(OFFLINE_HEADER)).toBe('1');
		expect(res.headers.get(SAVED_AT_HEADER)).toBe('2026-11-16T14:02:00.000Z');
		expect(await res.json()).toEqual([{ id: 1 }]);
	});

	it('rethrows the network error when nothing is saved', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(run(request(URL1, { auth: 'Bearer a' }))).rejects.toThrow('Failed to fetch');
	});

	it.each([502, 503, 504])('falls back to the saved copy on %i', async (status) => {
		fetchMock.mockResolvedValueOnce(json(['saved']));
		await run(request(URL1, { auth: 'Bearer a' }));
		fetchMock.mockResolvedValueOnce(new Response('bad gateway', { status }));
		const res = await run(request(URL1, { auth: 'Bearer a' }));
		expect(res.headers.get(OFFLINE_HEADER)).toBe('1');
		expect(await res.json()).toEqual(['saved']);
	});

	it('passes a 5xx through when nothing is saved', async () => {
		fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
		const res = await run(request(URL1, { auth: 'Bearer a' }));
		expect(res.status).toBe(503);
	});

	it('a 404 and a 403 are the truth, never replaced by saved data', async () => {
		fetchMock.mockResolvedValueOnce(json(['saved']));
		await run(request(URL1, { auth: 'Bearer a' }));
		for (const status of [404, 403, 500]) {
			fetchMock.mockResolvedValueOnce(new Response('no', { status }));
			expect((await run(request(URL1, { auth: 'Bearer a' }))).status).toBe(status);
		}
		const cache = await caches.open(await partitionName('Bearer a'));
		expect(cache.entries.size).toBe(1);
	});

	it('only stores 200 responses', async () => {
		fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
		await run(request(URL1, { auth: 'Bearer a' }));
		const cache = await caches.open(await partitionName('Bearer a'));
		expect(cache.entries.size).toBe(0);
	});

	it('a 401 deletes the partition and is returned (a revoked session keeps nothing)', async () => {
		fetchMock.mockResolvedValueOnce(json(['saved']));
		await run(request(URL1, { auth: 'Bearer a' }));
		fetchMock.mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
		const res = await run(request(URL1, { auth: 'Bearer a' }));
		expect(res.status).toBe(401);
		expect(await caches.keys()).toEqual([]);
	});

	it('a restricted session (403 body) is passed through, nothing replaced', async () => {
		fetchMock.mockResolvedValueOnce(json(['saved']));
		await run(request(URL1, { auth: 'Bearer a' }));
		fetchMock.mockResolvedValueOnce(json({ error: 'password_change_required' }, 403));
		const res = await run(request(URL1, { auth: 'Bearer a' }));
		expect(res.status).toBe(403);
	});

	it('two credentials get two partitions and never see each other\'s entries', async () => {
		fetchMock.mockResolvedValueOnce(json(['of-a']));
		await run(request(URL1, { auth: 'Bearer a' }));
		fetchMock.mockRejectedValueOnce(new TypeError('offline'));
		await expect(run(request(URL1, { auth: 'Bearer b' }))).rejects.toThrow();
		fetchMock.mockResolvedValueOnce(json(['of-b']));
		await run(request(URL1, { auth: 'Bearer b' }));
		fetchMock.mockRejectedValue(new TypeError('offline'));
		expect(await (await run(request(URL1, { auth: 'Bearer a' }))).json()).toEqual(['of-a']);
		expect(await (await run(request(URL1, { auth: 'Bearer b' }))).json()).toEqual(['of-b']);
		expect((await caches.keys()).length).toBe(2);
	});

	it('query order does not matter for the saved copy', async () => {
		fetchMock.mockResolvedValueOnce(json(['events']));
		await run(request('/api/events?workspace=2&since=1970-01-01T00:00:00Z', { auth: 'Bearer a' }));
		fetchMock.mockRejectedValue(new TypeError('offline'));
		const res = await run(request('/api/events?since=1970-01-01T00:00:00Z&workspace=2', { auth: 'Bearer a' }));
		expect(res.headers.get(OFFLINE_HEADER)).toBe('1');
	});

	it('after the timeout a saved copy is served; without one the slow network wins', async () => {
		fetchMock.mockResolvedValueOnce(json(['saved']));
		await run(request(URL1, { auth: 'Bearer a' }));

		fetchMock.mockImplementationOnce(() => new Promise(() => {}));
		const slow = run(request(URL1, { auth: 'Bearer a' }));
		await vi.advanceTimersByTimeAsync(0); // let the request start before time moves
		await vi.advanceTimersByTimeAsync(8001);
		expect((await slow).headers.get(OFFLINE_HEADER)).toBe('1');

		let resolve: (r: Response) => void = () => {};
		fetchMock.mockImplementationOnce(() => new Promise<Response>((r) => (resolve = r)));
		const noCopy = run(request('/api/languages', { auth: 'Bearer a' }));
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(20_000);
		resolve(json(['late']));
		expect(await (await noCopy).json()).toEqual(['late']);
	});

	it('a full cache (QuotaExceededError) still returns the response', async () => {
		const cache = await caches.open(await partitionName('Bearer a'));
		cache.putError = new DOMException('full', 'QuotaExceededError');
		fetchMock.mockResolvedValue(json(['x']));
		const res = await run(request(URL1, { auth: 'Bearer a' }));
		expect(await res.json()).toEqual(['x']);
	});
});

describe('navigate', () => {
	it('uses the network when it answers', async () => {
		fetchMock.mockResolvedValue(new Response('<html>net</html>', { headers: { 'content-type': 'text/html' } }));
		const res = await run(request('/study', { mode: 'navigate' }));
		expect(await res.text()).toBe('<html>net</html>');
	});

	it('falls back to the precached / on error, timeout and 503', async () => {
		await (await caches.open(SHELL)).put(ORIGIN + '/', new Response('<html>shell</html>'));
		fetchMock.mockRejectedValueOnce(new TypeError('offline'));
		expect(await (await run(request('/study', { mode: 'navigate' }))).text()).toBe('<html>shell</html>');
		fetchMock.mockResolvedValueOnce(new Response('x', { status: 503 }));
		expect(await (await run(request('/stats', { mode: 'navigate' }))).text()).toBe('<html>shell</html>');
		fetchMock.mockImplementationOnce(() => new Promise(() => {}));
		const slow = run(request('/', { mode: 'navigate' }));
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(4001);
		expect(await (await slow).text()).toBe('<html>shell</html>');
	});

	it('a 404 or 500 page is shown as is', async () => {
		await (await caches.open(SHELL)).put(ORIGIN + '/', new Response('shell'));
		fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
		expect((await run(request('/x', { mode: 'navigate' }))).status).toBe(500);
	});

	it('never stores a navigation or reads an API partition', async () => {
		fetchMock.mockResolvedValue(new Response('<html/>'));
		await run(request('/study', { mode: 'navigate' }));
		expect(await caches.keys()).toEqual([]);
	});
});

describe('shell', () => {
	it('is cache-first from the versioned shell cache', async () => {
		await (await caches.open(SHELL)).put(ORIGIN + '/_app/immutable/a.js', new Response('code'));
		const res = await run(request('/_app/immutable/a.js'));
		expect(await res.text()).toBe('code');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('goes to the network on a miss', async () => {
		fetchMock.mockResolvedValue(new Response('net'));
		expect(await (await run(request('/icons/icon-192.png'))).text()).toBe('net');
	});
});

describe('hanzi', () => {
	it('is cache-first and stored on demand', async () => {
		fetchMock.mockResolvedValue(json({ strokes: [] }));
		await run(request('/hanzi/U732B.json'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await run(request('/hanzi/U732B.json'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((await caches.open(HANZI_CACHE)).entries.size).toBe(1);
	});

	it('caps the cache by deleting the oldest entries', async () => {
		const cache = await caches.open(HANZI_CACHE);
		for (let i = 0; i < HANZI_CAP; i++) await cache.put(`${ORIGIN}/hanzi/U${(0x4e00 + i).toString(16).toUpperCase()}.json`, new Response('{}'));
		fetchMock.mockResolvedValue(json({}));
		await run(request('/hanzi/UFFFF.json'));
		expect(cache.entries.size).toBe(HANZI_CAP);
		expect(cache.entries.has(`${ORIGIN}/hanzi/U4E00.json`)).toBe(false);
		expect(cache.entries.has(`${ORIGIN}/hanzi/UFFFF.json`)).toBe(true);
	});

	it('does not store a failed fetch', async () => {
		fetchMock.mockResolvedValue(new Response('nope', { status: 404 }));
		await run(request('/hanzi/U1.json'));
		expect((await caches.open(HANZI_CACHE)).entries.size).toBe(0);
	});
});
