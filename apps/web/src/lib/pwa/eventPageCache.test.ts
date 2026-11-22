import { describe, expect, it } from 'vitest';
import { FakeCache, FakeCacheStorage } from '../testing/fakeCaches';
import { pruneEventPages, pruneSavedEventPages } from './eventPageCache';
import { ownPartition } from './partitions';

const ORIGIN = 'https://x.test';
const page = (next: string | null) =>
	new Response(JSON.stringify({ events: [], more: next !== null, next }), { headers: { 'content-type': 'application/json' } });

async function cacheWith(entries: Record<string, string | null>): Promise<FakeCache> {
	const cache = new FakeCache();
	for (const [path, next] of Object.entries(entries)) await cache.put(ORIGIN + path, page(next));
	return cache;
}

const keysOf = async (cache: FakeCache) => (await cache.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);

describe('pruneEventPages', () => {
	it('deletes the saved continuations of a workspace that no saved first page leads to', async () => {
		const cache = await cacheWith({
			'/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=7': 'e1.b',
			'/api/events?page=e1.a&workspace=7': 'e1.old', // an older walk's boundary
			'/api/events?page=e1.old&workspace=7': null,
			'/api/events?page=e1.b&workspace=7': 'e1.c',
			'/api/events?page=e1.c&workspace=7': null,
			'/api/events?page=e1.z&workspace=8': null, // another workspace: untouched
			'/api/events?since=1970-01-01T00%3A00%3A00Z&workspace=7': null, // the legacy copy: untouched
			'/api/workspaces': null
		});
		const deleted = await pruneEventPages(cache, 7);
		expect(deleted).toBe(2);
		expect(await keysOf(cache)).toEqual([
			'/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=7',
			'/api/events?page=e1.b&workspace=7',
			'/api/events?page=e1.c&workspace=7',
			'/api/events?page=e1.z&workspace=8',
			'/api/events?since=1970-01-01T00%3A00%3A00Z&workspace=7',
			'/api/workspaces'
		]);
	});

	it('keeps every chain that a saved first page starts (several since values)', async () => {
		const cache = await cacheWith({
			'/api/events?limit=2000&since=1970-01-01T00%3A00%3A00Z&workspace=7': 'e1.a',
			'/api/events?limit=2000&since=2026-01-01T00%3A00%3A00Z&workspace=7': 'e1.s',
			'/api/events?page=e1.a&workspace=7': null,
			'/api/events?page=e1.s&workspace=7': null
		});
		expect(await pruneEventPages(cache, 7)).toBe(0);
	});

	it('stops on a cycle and on an unreadable saved page', async () => {
		const cache = await cacheWith({
			'/api/events?limit=2000&workspace=7': 'e1.a',
			'/api/events?page=e1.a&workspace=7': 'e1.b',
			'/api/events?page=e1.b&workspace=7': 'e1.a',
			'/api/events?page=e1.gone&workspace=7': null
		});
		await cache.put(ORIGIN + '/api/events?page=e1.bad&workspace=7', new Response('{oops'));
		expect(await pruneEventPages(cache, 7)).toBe(2);
		expect(await keysOf(cache)).toEqual([
			'/api/events?limit=2000&workspace=7',
			'/api/events?page=e1.a&workspace=7',
			'/api/events?page=e1.b&workspace=7'
		]);
	});
});

describe('pruneSavedEventPages', () => {
	it('prunes the partition of the current credential only, and does nothing without one', async () => {
		const storage = new FakeCacheStorage();
		const mine = await storage.open(await ownPartition('tok'));
		const other = await storage.open(await ownPartition('other'));
		for (const c of [mine, other]) {
			await c.put(ORIGIN + '/api/events?limit=2000&workspace=7', page(null));
			await c.put(ORIGIN + '/api/events?page=e1.old&workspace=7', page(null));
		}
		await pruneSavedEventPages(7, { caches: storage, token: null });
		expect(await keysOf(mine)).toHaveLength(2);
		await pruneSavedEventPages(7, { caches: undefined, token: 'tok' });
		expect(await keysOf(mine)).toHaveLength(2);
		await pruneSavedEventPages(7, { caches: storage, token: 'tok' });
		expect(await keysOf(mine)).toEqual(['/api/events?limit=2000&workspace=7']);
		expect(await keysOf(other)).toHaveLength(2);
	});
});
