import { describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from '../../testing/fakeCaches';
import { startWorker, type FetchEv, type SwEv, type SwScope } from './worker';

const ORIGIN = 'https://qinqin.example';

type Listener = (e: never) => void;

function fakeScope(fetchImpl: (req: Request) => Promise<Response>) {
	const listeners = new Map<string, Listener[]>();
	const caches = new FakeCacheStorage();
	const scope: SwScope = {
		addEventListener: ((type: string, l: Listener) => {
			listeners.set(type, [...(listeners.get(type) ?? []), l]);
		}) as SwScope['addEventListener'],
		skipWaiting: vi.fn(async () => {}),
		clients: { claim: vi.fn(async () => {}) },
		caches,
		fetch: ((req: Request) => fetchImpl(req)) as SwScope['fetch'],
		location: { origin: ORIGIN }
	};
	const emit = (type: string, event: object) => listeners.get(type)?.forEach((l) => l(event as never));
	return { scope, caches, emit, listeners };
}

function waitable(): { waited: Promise<unknown>[]; ev: SwEv } {
	const waited: Promise<unknown>[] = [];
	return { waited, ev: { waitUntil: (p) => void waited.push(p) } };
}

function fetchEvent(req: Request): { ev: FetchEv; responded: () => Promise<Response> | undefined } {
	let r: Promise<Response> | undefined;
	return {
		ev: { request: req, waitUntil: () => {}, respondWith: (p) => void (r = Promise.resolve(p)) },
		responded: () => r
	};
}

const config = { version: 'v9', build: ['/_app/immutable/a.js'], files: ['/manifest.webmanifest', '/icons/icon-192.png'] };

describe('startWorker with a fake ServiceWorkerGlobalScope', () => {
	it('install precaches the whole shell and does NOT skip waiting by itself', async () => {
		const { scope, caches, emit } = fakeScope(async (req) => new Response(new URL(req.url).pathname));
		startWorker(scope, config);
		const { waited, ev } = waitable();
		emit('install', ev);
		await Promise.all(waited);
		expect((await caches.open('qinqin-shell-v9')).entries.size).toBe(4);
		expect(scope.skipWaiting).not.toHaveBeenCalled();
	});

	it('activate removes old shells and claims', async () => {
		const { scope, caches, emit } = fakeScope(async () => new Response(''));
		await caches.open('qinqin-shell-old');
		startWorker(scope, config);
		const { waited, ev } = waitable();
		emit('activate', ev);
		await Promise.all(waited);
		expect(await caches.keys()).toEqual([]);
		expect(scope.clients.claim).toHaveBeenCalled();
	});

	it('skipWaiting only on the skip-waiting message', () => {
		const { scope, emit } = fakeScope(async () => new Response(''));
		startWorker(scope, config);
		emit('message', { data: { type: 'noise' } });
		expect(scope.skipWaiting).not.toHaveBeenCalled();
		emit('message', { data: { type: 'skip-waiting' } });
		expect(scope.skipWaiting).toHaveBeenCalledTimes(1);
	});

	it('does not answer bypass requests (the browser handles them)', () => {
		const { scope, emit } = fakeScope(async () => new Response(''));
		startWorker(scope, config);
		for (const req of [
			new Request(`${ORIGIN}/api/admin/users`, { headers: { authorization: 'Bearer t' } }),
			new Request(`${ORIGIN}/api/workspaces`, { method: 'POST', headers: { authorization: 'Bearer t' }, body: '{}' }),
			new Request(`${ORIGIN}/api/workspaces`),
			new Request('https://other.example/x.js')
		]) {
			const { ev, responded } = fetchEvent(req);
			emit('fetch', ev);
			expect(responded()).toBeUndefined();
		}
	});

	it('answers an allowlisted API read and saves it for that credential only', async () => {
		const { scope, caches, emit } = fakeScope(async () => new Response('[1]', { status: 200 }));
		startWorker(scope, config);
		const { ev, responded } = fetchEvent(new Request(`${ORIGIN}/api/workspaces`, { headers: { authorization: 'Bearer t' } }));
		emit('fetch', ev);
		expect(await (await responded()!).text()).toBe('[1]');
		const names = await caches.keys();
		expect(names).toHaveLength(1);
		expect(names[0]).toMatch(/^qinqin-api-v1-[0-9a-f]{32}$/);
	});

	it('serves a precached shell file without the network', async () => {
		const fetchMock = vi.fn(async (req: Request) => new Response(new URL(req.url).pathname));
		const { scope, emit } = fakeScope(fetchMock);
		startWorker(scope, config);
		const inst = waitable();
		emit('install', inst.ev);
		await Promise.all(inst.waited);
		fetchMock.mockClear();
		const { ev, responded } = fetchEvent(new Request(`${ORIGIN}/_app/immutable/a.js`));
		emit('fetch', ev);
		expect(await (await responded()!).text()).toBe('/_app/immutable/a.js');
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
