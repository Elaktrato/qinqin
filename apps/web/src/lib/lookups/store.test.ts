import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));
vi.mock('../events', async (orig) => ({ ...(await orig<typeof import('../events')>()), invalidateWorkspaceEvents: invalidate }));

import { FakeCacheStorage } from '../testing/fakeCaches';
import { ownPartition } from '../pwa/partitions';
import {
	LookupEventsNotDeletedError,
	clearHistory,
	forgetOfflineLookups,
	loadHistory,
	loadLookupCfg,
	lookupRecorder,
	recorderIO,
	removeFromHistory,
	repairAfterClear,
	resetLookupRecorder,
	saveLookupCfg
} from './store';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const calls = () =>
	vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), (init as RequestInit | undefined)?.method ?? 'GET', (init as RequestInit | undefined)?.body] as const);
const T = '2026-11-15T09:00:00.000Z';
const item = (entryId: number) => ({ entryId, count: 1, firstAt: T, lastAt: T, sources: { reader: 1 }, books: [] });
const listOf = (data: unknown) => json([{ pluginId: 'qinqin-core', key: 'lookups', data, version: 1, updatedAt: T }]);

beforeEach(() => {
	vi.stubGlobal('localStorage', { getItem: () => 'tok', setItem: () => {}, removeItem: () => {} });
	vi.stubGlobal('fetch', vi.fn());
	invalidate.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('lookups store', () => {
	it('loads the workspace row through the prefix route', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(listOf({ version: 1, clearedAt: null, items: [item(5)], x: 1 }));
		const h = await loadHistory(3);
		expect(h.items.map((i) => i.entryId)).toEqual([5]);
		expect(h.extra).toEqual({ x: 1 });
		expect(calls()[0].slice(0, 2)).toEqual(['/api/plugins/qinqin-core/data?workspace=3&prefix=lookups', 'GET']);
	});

	it('a missing row is an empty history', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		expect((await loadHistory(3)).items).toEqual([]);
	});

	it('removes by reading, then writing the row without the ids', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(listOf({ version: 1, clearedAt: null, items: [item(5), item(6), item(7)] }));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		const h = await removeFromHistory(3, [5, 7]);
		expect(h.items.map((i) => i.entryId)).toEqual([6]);
		const [, put] = calls();
		expect(put.slice(0, 2)).toEqual(['/api/plugins/qinqin-core/data/lookups?workspace=3', 'PUT']);
		expect(JSON.parse(String(put[2])).items.map((i: { entryId: number }) => i.entryId)).toEqual([6]);
	});

	it('clears with a PUT of the empty row, then deletes the lookup events; never a DELETE of the row', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(listOf({ version: 1, clearedAt: null, items: [item(5)], x: 1 }));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		vi.mocked(fetch).mockResolvedValueOnce(json({ deleted: 4 }));
		const out = await clearHistory(3, new Date('2026-11-16T12:00:00.000Z'));
		expect(out.eventsDeleted).toBe(4);
		expect(out.history).toEqual({ clearedAt: '2026-11-16T12:00:00.000Z', items: [], extra: { x: 1 } });
		const c = calls();
		expect(c.map((x) => x.slice(0, 2))).toEqual([
			['/api/plugins/qinqin-core/data?workspace=3&prefix=lookups', 'GET'],
			['/api/plugins/qinqin-core/data/lookups?workspace=3', 'PUT'],
			['/api/events/lookups?workspace=3', 'DELETE']
		]);
		expect(JSON.parse(String(c[1][2]))).toEqual({ x: 1, version: 1, clearedAt: '2026-11-16T12:00:00.000Z', items: [] });
		expect(c.some(([url, method]) => method === 'DELETE' && url.includes('/api/plugins/'))).toBe(false);
		expect(invalidate).toHaveBeenCalledWith(3);
	});

	it('a failed event delete after the row was cleared says what remains', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
		const err = await clearHistory(3).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LookupEventsNotDeletedError);
		expect(String((err as Error).message)).toMatch(/history is cleared/i);
		expect(String((err as Error).message)).toMatch(/old search records/i);
	});

	it('a failed row write stops before the event delete', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
		await expect(clearHistory(3)).rejects.toBeTruthy();
		expect(calls()).toHaveLength(2);
	});

	it('the clear uses the server time of its write as clearedAt (clock skew)', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		vi.mocked(fetch).mockResolvedValueOnce(json({ key: 'lookups', updatedAt: '2026-11-16T11:59:58Z' }));
		vi.mocked(fetch).mockResolvedValueOnce(json({ key: 'lookups', updatedAt: '2026-11-16T11:59:59Z' }));
		vi.mocked(fetch).mockResolvedValueOnce(json({ deleted: 0 }));
		const out = await clearHistory(3, new Date('2026-11-16T12:00:07.000Z'));
		expect(out.history.clearedAt).toBe('2026-11-16T11:59:58Z');
		const c = calls();
		expect(c.map((x) => x[1])).toEqual(['GET', 'PUT', 'PUT', 'DELETE']);
		expect(JSON.parse(String(c[1][2])).clearedAt).toBe('2026-11-16T12:00:07.000Z');
		expect(JSON.parse(String(c[2][2]))).toEqual({ version: 1, clearedAt: '2026-11-16T11:59:58Z', items: [] });
	});

	it('repairAfterClear clears again when the row is not my clear any more', async () => {
		const mine = '2026-11-16T12:00:00Z';
		vi.mocked(fetch).mockResolvedValueOnce(listOf({ version: 1, clearedAt: null, items: [item(5)] }));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		expect(await repairAfterClear(3, mine)).toBe(true);
		expect(calls()[1].slice(0, 2)).toEqual(['/api/plugins/qinqin-core/data/lookups?workspace=3', 'PUT']);
		expect(JSON.parse(String(calls()[1][2]))).toEqual({ version: 1, clearedAt: mine, items: [] });
		vi.mocked(fetch).mockResolvedValueOnce(listOf({ version: 1, clearedAt: mine, items: [{ ...item(6), lastAt: '2026-11-16T12:00:05Z' }] }));
		expect(await repairAfterClear(3, mine)).toBe(false);
		expect(calls()).toHaveLength(3);
	});
	it('reads and writes the user-global switch, keeping unknown members', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([{ key: 'lookupcfg', data: { version: 1, record: false, k: 2 } }]));
		expect(await loadLookupCfg()).toEqual({ record: false, extra: { k: 2 } });
		expect(calls()[0][0]).toBe('/api/plugins/qinqin-core/data?prefix=lookupcfg');
		vi.mocked(fetch).mockResolvedValueOnce(json([{ key: 'lookupcfg', data: { version: 1, record: false, k: 2 } }]));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		await saveLookupCfg(true);
		const [url, method, body] = calls()[2];
		expect([url, method]).toEqual(['/api/plugins/qinqin-core/data/lookupcfg', 'PUT']);
		expect(JSON.parse(String(body))).toEqual({ k: 2, version: 1, record: true });
	});

	it('the recorder I/O reads and writes the same routes', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		expect(await recorderIO.readRow(4)).toBeNull();
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		await recorderIO.writeRow(4, { version: 1, clearedAt: null, items: [] });
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		expect(await recorderIO.readCfg()).toBeNull();
		expect(calls().map((c) => c.slice(0, 2))).toEqual([
			['/api/plugins/qinqin-core/data?workspace=4&prefix=lookups', 'GET'],
			['/api/plugins/qinqin-core/data/lookups?workspace=4', 'PUT'],
			['/api/plugins/qinqin-core/data?prefix=lookupcfg', 'GET']
		]);
	});

	it('lookupRecorder is one recorder per tab', () => {
		expect(lookupRecorder()).toBe(lookupRecorder());
	});
});

describe('forgetOfflineLookups', () => {
	it("deletes the own partition's saved pulls, event logs and core plugin data, nothing else", async () => {
		const caches = new FakeCacheStorage();
		const own = await caches.open(await ownPartition('tok'));
		const other = await caches.open('qinqin-api-v1-someoneelse');
		const keep = [
			'https://app.test/api/plugins/qinqin-flashcards/data?workspace=3&prefix=card%3A',
			'https://app.test/api/workspaces',
			'https://app.test/api/entries/12'
		];
		const drop = [
			'https://app.test/api/sync/pull?collections=pluginData%2CpluginStates&cursor=1970-01-01T00%3A00%3A00Z',
			'https://app.test/api/events?since=1970-01-01T00%3A00%3A00Z&workspace=3',
			'https://app.test/api/plugins/qinqin-core/data?workspace=3'
		];
		for (const u of [...keep, ...drop]) await own.put(u, new Response('x'));
		await other.put(drop[0], new Response('x'));
		await forgetOfflineLookups(caches);
		expect([...own.entries.keys()]).toEqual(keep);
		expect(other.entries.size).toBe(1);
	});

	it('does nothing without Cache Storage or a token', async () => {
		await forgetOfflineLookups(undefined);
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
		const caches = new FakeCacheStorage();
		await forgetOfflineLookups(caches);
		expect(caches.stores.size).toBe(0);
	});
});

describe('Clear against another device that read the row before it (the real race)', () => {
	interface Row { data: unknown; updatedAt: string }
	let server: Map<number, Row>;
	let serverNow: string;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-16T12:00:00.400Z'));
		server = new Map();
		serverNow = '2026-11-16T12:00:00Z';
		vi.mocked(fetch).mockImplementation(async (input, init) => {
			const url = new URL(String(input), 'http://x');
			const method = (init as RequestInit | undefined)?.method ?? 'GET';
			const ws = Number(url.searchParams.get('workspace'));
			if (url.pathname === '/api/events/lookups') return json({ deleted: 1 });
			if (method === 'GET') {
				const r = server.get(ws);
				return json(r ? [{ key: 'lookups', data: r.data, updatedAt: r.updatedAt }] : []);
			}
			if (method === 'PUT') {
				server.set(ws, { data: JSON.parse(String((init as RequestInit).body)), updatedAt: serverNow });
				return json({ key: 'lookups', updatedAt: serverNow });
			}
			return json({});
		});
	});
	afterEach(() => vi.useRealTimers());

	it('a stale write-back with the old clearedAt is cleared again 30 s later, once, even after leaving the page', async () => {
		const old = { version: 1, clearedAt: null, items: [item(5)] };
		server.set(3, { data: old, updatedAt: T });
		const deviceBRead = structuredClone(old); // B reads before the Clear
		const repaired = vi.fn();
		await clearHistory(3, new Date(), { onRepaired: repaired });
		expect(server.get(3)!.data).toEqual({ version: 1, clearedAt: '2026-11-16T12:00:00Z', items: [] });
		// B writes back its merge of the stale copy: its own (old) clearedAt
		serverNow = '2026-11-16T12:00:03Z';
		server.set(3, { data: { ...deviceBRead, items: [...deviceBRead.items, { ...item(6), lastAt: '2026-11-16T12:00:02Z' }] }, updatedAt: serverNow });
		await vi.advanceTimersByTimeAsync(29_000);
		expect((server.get(3)!.data as { items: unknown[] }).items).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(server.get(3)!.data).toEqual({ version: 1, clearedAt: '2026-11-16T12:00:00Z', items: [] });
		expect(repaired).toHaveBeenCalledWith(3);
		// only once
		server.set(3, { data: old, updatedAt: serverNow });
		await vi.advanceTimersByTimeAsync(120_000);
		expect(server.get(3)!.data).toEqual(old);
	});

	it('sign-out cancels a pending repair', async () => {
		server.set(3, { data: { version: 1, clearedAt: null, items: [item(5)] }, updatedAt: T });
		await clearHistory(3, new Date());
		const stale = { version: 1, clearedAt: null, items: [item(5)] };
		server.set(3, { data: stale, updatedAt: T });
		resetLookupRecorder();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(server.get(3)!.data).toEqual(stale);
	});
});
