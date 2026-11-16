import { describe, expect, it, vi } from 'vitest';
import { FakeCacheStorage } from '../../testing/fakeCaches';
import { onActivate, onInstall, onMessage, shellCacheName } from './lifecycle';

const ORIGIN = 'https://qinqin.example';

function okFetch() {
	return vi.fn<(req: Request) => Promise<Response>>(async (req) => new Response(`body of ${new URL(req.url).pathname}`));
}

describe('onInstall', () => {
	it('precaches every shell URL plus / into the versioned cache, bypassing the HTTP cache', async () => {
		const caches = new FakeCacheStorage();
		const fetchMock = okFetch();
		await onInstall({ caches, fetch: fetchMock, origin: ORIGIN }, 'v7', ['/_app/immutable/a.js', '/manifest.webmanifest']);
		const cache = await caches.open(shellCacheName('v7'));
		expect([...cache.entries.keys()].sort()).toEqual(
			[`${ORIGIN}/`, `${ORIGIN}/_app/immutable/a.js`, `${ORIGIN}/manifest.webmanifest`].sort()
		);
		for (const [req] of fetchMock.mock.calls) expect((req as Request).cache).toBe('reload');
	});

	it('does not duplicate / when the list already has it', async () => {
		const caches = new FakeCacheStorage();
		await onInstall({ caches, fetch: okFetch(), origin: ORIGIN }, 'v1', ['/', '/a.js']);
		expect((await caches.open(shellCacheName('v1'))).entries.size).toBe(2);
	});

	it('a failed precache rejects install and leaves no half-filled cache behind', async () => {
		const caches = new FakeCacheStorage();
		const fetchMock = vi.fn(async (req: Request) =>
			new URL(req.url).pathname === '/b.js' ? new Response('gone', { status: 404 }) : new Response('ok')
		);
		await expect(onInstall({ caches, fetch: fetchMock, origin: ORIGIN }, 'v2', ['/a.js', '/b.js'])).rejects.toThrow(/b\.js/);
		expect(await caches.keys()).toEqual([]);
	});

	it('a network error rejects install too', async () => {
		const caches = new FakeCacheStorage();
		const fetchMock = vi.fn(async () => {
			throw new TypeError('offline');
		});
		await expect(onInstall({ caches, fetch: fetchMock, origin: ORIGIN }, 'v2', ['/a.js'])).rejects.toThrow();
	});
});

describe('onActivate', () => {
	it('keeps the current shell, hanzi and the current API partitions; removes old generations; claims', async () => {
		const caches = new FakeCacheStorage();
		for (const name of [
			'qinqin-shell-old',
			'qinqin-shell-v7',
			'qinqin-api-v1-abc',
			'qinqin-api-v0-legacy',
			'qinqin-api-v2-future',
			'qinqin-hanzi-v1',
			'unrelated'
		]) {
			await caches.open(name);
		}
		const claim = vi.fn(async () => {});
		await onActivate({ caches, claim }, 'v7');
		expect((await caches.keys()).sort()).toEqual(['qinqin-api-v1-abc', 'qinqin-api-v2-future', 'qinqin-hanzi-v1', 'qinqin-shell-v7', 'unrelated']);
		expect(claim).toHaveBeenCalledTimes(1);
	});
});

describe('onMessage', () => {
	it('skip-waiting calls skipWaiting; anything else does nothing', () => {
		const skip = vi.fn();
		onMessage({ type: 'skip-waiting' }, skip);
		expect(skip).toHaveBeenCalledTimes(1);
		for (const data of [null, undefined, 'skip-waiting', { type: 'other' }, 7]) onMessage(data, skip);
		expect(skip).toHaveBeenCalledTimes(1);
	});
});
