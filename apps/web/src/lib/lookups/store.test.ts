import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));
const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));

import { FakeCacheStorage } from '../testing/fakeCaches';
import { ownPartition } from '../pwa/partitions';
import {
	LookupEventsNotDeletedError,
	clearHistory,
	scrubOfflineLookups,
	loadHistory,
	loadLookupCfg,
	removeFromHistory,
	repairAfterClear,
	saveLookupCfg
} from './store';
import { LookupsState, recorderIO } from './state';

// A fresh recorder state per test (record 0009: the session's).
let lookups: LookupsState;
import { dataRow } from '../testing/keyed';

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const calls = () =>
	vi.mocked(fetch).mock.calls.map(([url, init]) => [String(url), (init as RequestInit | undefined)?.method ?? 'GET', (init as RequestInit | undefined)?.body] as const);
const T = '2026-11-15T09:00:00.000Z';
const item = (entryId: number) => ({ entryId, count: 1, firstAt: T, lastAt: T, sources: { reader: 1 }, books: [] });
const listOf = (data: unknown) => json([dataRow({ pluginId: 'qinqin-core', key: 'lookups', data, version: 1, updatedAt: T })]);

beforeEach(() => {
	vi.stubGlobal('localStorage', { getItem: () => 'tok', setItem: () => {}, removeItem: () => {} });
	vi.stubGlobal('fetch', vi.fn());
	invalidate.mockReset();
	lookups = new LookupsState();
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
		const h = await removeFromHistory(lookups, 3, [5, 7]);
		expect(h.items.map((i) => i.entryId)).toEqual([6]);
		const [, put] = calls();
		expect(put.slice(0, 2)).toEqual(['/api/plugins/qinqin-core/data/lookups?workspace=3', 'PUT']);
		expect(JSON.parse(String(put[2])).items.map((i: { entryId: number }) => i.entryId)).toEqual([6]);
	});

	it('clears with a PUT of the empty row, then deletes the lookup events; never a DELETE of the row', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(listOf({ version: 1, clearedAt: null, items: [item(5)], x: 1 }));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		vi.mocked(fetch).mockResolvedValueOnce(json({ deleted: 4 }));
		const out = await clearHistory(lookups, 3, new Date('2026-11-16T12:00:00.000Z'), { invalidateEvents: invalidate });
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

	it('a session that ends during the clear schedules no repair and deletes nothing with the next token', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		vi.mocked(fetch).mockImplementationOnce(async () => {
			// The session ends while its row is being written.
			lookups.dispose();
			return json({});
		});
		const out = await clearHistory(lookups, 3);
		expect(out.eventsDeleted).toBe(0);
		expect(calls().some(([, method]) => method === 'DELETE')).toBe(false);
		expect(lookups.repairs.size).toBe(0);
	});

	it('a failed event delete after the row was cleared says what remains', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
		const err = await clearHistory(lookups, 3).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(LookupEventsNotDeletedError);
		expect(String((err as Error).message)).toMatch(/history is cleared/i);
		expect(String((err as Error).message)).toMatch(/old search records/i);
	});

	it('a failed row write stops before the event delete', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		vi.mocked(fetch).mockResolvedValueOnce(new Response('boom', { status: 500 }));
		await expect(clearHistory(lookups, 3)).rejects.toBeTruthy();
		expect(calls()).toHaveLength(2);
	});

	it('the clear uses the server time of its write as clearedAt (clock skew)', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([]));
		vi.mocked(fetch).mockResolvedValueOnce(json(dataRow({ key: 'lookups', workspaceId: 3, updatedAt: '2026-11-16T11:59:58Z' })));
		vi.mocked(fetch).mockResolvedValueOnce(json(dataRow({ key: 'lookups', workspaceId: 3, updatedAt: '2026-11-16T11:59:59Z' })));
		vi.mocked(fetch).mockResolvedValueOnce(json({ deleted: 0 }));
		const out = await clearHistory(lookups, 3, new Date('2026-11-16T12:00:07.000Z'));
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
		expect(await repairAfterClear(lookups, 3, mine)).toBe(true);
		expect(calls()[1].slice(0, 2)).toEqual(['/api/plugins/qinqin-core/data/lookups?workspace=3', 'PUT']);
		expect(JSON.parse(String(calls()[1][2]))).toEqual({ version: 1, clearedAt: mine, items: [] });
		vi.mocked(fetch).mockResolvedValueOnce(listOf({ version: 1, clearedAt: mine, items: [{ ...item(6), lastAt: '2026-11-16T12:00:05Z' }] }));
		expect(await repairAfterClear(lookups, 3, mine)).toBe(false);
		expect(calls()).toHaveLength(3);
	});
	it('reads and writes the user-global switch, keeping unknown members', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(json([dataRow({ key: 'lookupcfg', data: { version: 1, record: false, k: 2 } })]));
		expect(await loadLookupCfg()).toEqual({ record: false, extra: { k: 2 } });
		expect(calls()[0][0]).toBe('/api/plugins/qinqin-core/data?prefix=lookupcfg');
		vi.mocked(fetch).mockResolvedValueOnce(json([dataRow({ key: 'lookupcfg', data: { version: 1, record: false, k: 2 } })]));
		vi.mocked(fetch).mockResolvedValueOnce(json({}));
		await saveLookupCfg(lookups, true);
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

	it('a session has one recorder', () => {
		expect(lookups.recorder).toBe(lookups.recorder);
	});
});

describe('scrubOfflineLookups', () => {
	const pullUrl = 'https://app.test/api/sync/pull?collections=pluginData%2CpluginStates&cursor=1970-01-01T00%3A00%3A00Z';
	const eventsUrl = 'https://app.test/api/events?since=1970-01-01T00%3A00%3A00Z&workspace=3';
	const noteUrl = 'https://app.test/api/plugins/qinqin-core/data?workspace=3&prefix=note%3A';
	const savedAt = { 'content-type': 'application/json', 'x-qinqin-saved-at': '2026-11-16T10:00:00.000Z' };

	it("filters the own partition's saved pull and event logs in place; offline study stays ready", async () => {
		const removed: string[] = [];
		vi.stubGlobal('localStorage', {
			getItem: () => 'tok', setItem: () => {}, removeItem: (k: string) => removed.push(k), length: 1, key: () => 'qinqin.pwa.prepared.1.3'
		});
		const caches = new FakeCacheStorage();
		const own = await caches.open(await ownPartition('tok'));
		const other = await caches.open('qinqin-api-v1-someoneelse');
		const pull = { pluginData: [dataRow({ pluginId: 'qinqin-core', key: 'lookups', data: { items: [{ entryId: 5 }] } }), dataRow({ pluginId: 'qinqin-core', key: 'note:5', data: { text: 'n' } })] };
		await own.put(pullUrl, new Response(JSON.stringify(pull), { headers: savedAt }));
		await own.put(eventsUrl, new Response(JSON.stringify([{ id: '1', type: 'lookup', payload: { query: 'ma' } }, { id: '2', type: 'review' }]), { headers: savedAt }));
		await own.put(noteUrl, new Response('[]', { headers: savedAt }));
		await own.put('https://app.test/api/workspaces', new Response('[1]'));
		await other.put(pullUrl, new Response(JSON.stringify(pull)));
		await scrubOfflineLookups(caches);
		expect([...own.entries.keys()].sort()).toEqual([pullUrl, eventsUrl, noteUrl, 'https://app.test/api/workspaces'].sort());
		const savedPull = await (await own.match(pullUrl))!.json();
		expect(savedPull.pluginData.map((r: { key: string }) => r.key)).toEqual(['note:5']);
		expect((await own.match(pullUrl))!.headers.get('x-qinqin-saved-at')).toBe('2026-11-16T10:00:00.000Z');
		expect((await (await own.match(eventsUrl))!.json()).map((e: { id: string }) => e.id)).toEqual(['2']);
		expect(other.entries.size).toBe(1);
		expect(removed).toEqual([]); // nothing deleted: the prepared receipts stay
	});

	it('deletes an unreadable saved copy or a saved lookups read, and then clears the prepared receipts', async () => {
		const removed: string[] = [];
		vi.stubGlobal('localStorage', {
			getItem: () => 'tok', setItem: () => {}, removeItem: (k: string) => removed.push(k), length: 1, key: () => 'qinqin.pwa.prepared.1.3'
		});
		const caches = new FakeCacheStorage();
		const own = await caches.open(await ownPartition('tok'));
		await own.put(pullUrl, new Response('{broken'));
		await own.put('https://app.test/api/plugins/qinqin-core/data?workspace=3', new Response('[]'));
		await scrubOfflineLookups(caches);
		expect(own.entries.size).toBe(0);
		expect(removed).toEqual(['qinqin.pwa.prepared.1.3']);
	});

	it('does nothing without Cache Storage or a token', async () => {
		await scrubOfflineLookups(undefined);
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
		const caches = new FakeCacheStorage();
		await scrubOfflineLookups(caches);
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
				return json(r ? [dataRow({ key: 'lookups', data: r.data, updatedAt: r.updatedAt })] : []);
			}
			if (method === 'PUT') {
				server.set(ws, { data: JSON.parse(String((init as RequestInit).body)), updatedAt: serverNow });
				return json(dataRow({ key: 'lookups', workspaceId: ws, updatedAt: serverNow }));
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
		await clearHistory(lookups, 3, new Date(), { onRepaired: repaired });
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

	it('the end of the session cancels a pending repair', async () => {
		server.set(3, { data: { version: 1, clearedAt: null, items: [item(5)] }, updatedAt: T });
		await clearHistory(lookups, 3, new Date());
		const stale = { version: 1, clearedAt: null, items: [item(5)] };
		server.set(3, { data: stale, updatedAt: T });
		lookups.dispose();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(server.get(3)!.data).toEqual(stale);
	});
});
