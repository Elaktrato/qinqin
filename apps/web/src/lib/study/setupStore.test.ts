import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/client';
import { memoryStorage } from '$lib/testing/context';
import { defaultSetup } from './setup';
import { StudySetups, setupCacheKey, setupCacheWorkspace, type StudySetupsDeps } from './setupStore.svelte';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (err: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function make(over: Partial<StudySetupsDeps> = {}, server = new Map<number, unknown>(), local = memoryStorage()) {
	let alive = true;
	const deps: StudySetupsDeps = {
		load: vi.fn(async (ws: number) => server.get(ws) ?? null),
		save: vi.fn(async (ws: number, data: unknown) => void server.set(ws, data)),
		local: () => local,
		user: () => 1,
		alive: () => alive,
		exists: () => true,
		...over
	};
	return { store: new StudySetups(deps), deps, local, server, end: () => (alive = false) };
}

const SYNCED = { version: 1, decks: ['d1'], newLimit: 7, reviewLimit: 33, typeOrder: 'grouped', cardTypes: ['vocab', 'writing'], future: { x: 1 } };

describe('StudySetups', () => {
	it('answers the defaults at once when nothing is known, and says it knows nothing', () => {
		const { store } = make();
		expect(store.of(4)).toMatchObject({ setup: defaultSetup(), loaded: false, known: false, saveError: null });
	});

	it('answers the device cache at once (known), then the server', async () => {
		const { store, local, server } = make();
		local.setItem(setupCacheKey(1, 4), JSON.stringify({ raw: { version: 1, newLimit: 9 }, pending: null }));
		server.set(4, { version: 1, newLimit: 12 });
		expect(store.of(4)).toMatchObject({ loaded: false, known: true });
		expect(store.of(4).setup.newLimit).toBe(9);
		await store.refresh(4);
		expect(store.of(4)).toMatchObject({ loaded: true, known: true });
		expect(store.of(4).setup.newLimit).toBe(12);
		expect(JSON.parse(local.getItem(setupCacheKey(1, 4))!).raw).toEqual({ version: 1, newLimit: 12 });
	});

	it("never reads another user's cache", () => {
		const { store, local } = make();
		local.setItem(setupCacheKey(2, 4), JSON.stringify({ raw: { version: 1, newLimit: 9 }, pending: null }));
		expect(store.of(4).setup.newLimit).toBe(20);
	});

	it('an update paints at once and writes only its members over the stored row', async () => {
		const { store, server, deps } = make();
		server.set(4, SYNCED);
		const saving = store.update(4, { newLimit: 5 });
		expect(store.of(4).setup.newLimit).toBe(5);
		await saving;
		expect(deps.save).toHaveBeenCalledTimes(1);
		expect(server.get(4)).toMatchObject({ decks: ['d1'], reviewLimit: 33, typeOrder: 'grouped', cardTypes: ['vocab', 'writing'], future: { x: 1 }, newLimit: 5 });
		expect(store.of(4)).toMatchObject({ saveError: null, loaded: true });
		expect(store.of(4).setup).toMatchObject({ decks: ['d1'], newLimit: 5 });
	});

	it('a change made before the row has loaded (a cold device) keeps the synced members (review blocker)', async () => {
		const { store, server } = make();
		server.set(4, SYNCED);
		const refreshing = store.refresh(4);
		await store.update(4, { cardTypes: ['vocab', 'sentence'] });
		await refreshing;
		expect(server.get(4)).toMatchObject({ decks: ['d1'], newLimit: 7, reviewLimit: 33, typeOrder: 'grouped', cardTypes: ['vocab', 'sentence'] });
		expect(store.of(4).setup).toMatchObject({ decks: ['d1'], newLimit: 7, cardTypes: ['vocab', 'sentence'] });
	});

	it('two devices changing different members keep both (review should-fix)', async () => {
		const server = new Map<number, unknown>();
		const a = make({}, server).store;
		const b = make({}, server).store;
		await a.refresh(4);
		await b.refresh(4);
		await a.update(4, { newLimit: 9 });
		await b.update(4, { typeOrder: 'grouped' });
		expect(server.get(4)).toMatchObject({ newLimit: 9, typeOrder: 'grouped' });
	});

	it('keeps each workspace apart', async () => {
		const { store, server } = make();
		await store.update(4, { newLimit: 5 });
		expect(server.get(5)).toBeUndefined();
		expect(store.of(5).setup.newLimit).toBe(20);
	});

	it('a load begun before an update never puts the old value back', async () => {
		const slow = deferred<unknown>();
		let calls = 0;
		const { store } = make({ load: vi.fn(() => (++calls === 1 ? slow.promise : Promise.resolve(null))) });
		const reading = store.refresh(4);
		await store.update(4, { newLimit: 5 });
		slow.resolve({ version: 1, newLimit: 50 });
		await reading;
		expect(store.of(4).setup.newLimit).toBe(5);
	});

	it('writes one after another, the last change last', async () => {
		const order: number[] = [];
		const { store } = make({ save: vi.fn(async (_ws: number, data: unknown) => void order.push((data as { newLimit: number }).newLimit)) });
		await Promise.all([store.update(4, { newLimit: 6 }), store.update(4, { newLimit: 7 })]);
		expect(order.at(-1)).toBe(7);
		expect(store.of(4).setup.newLimit).toBe(7);
	});

	it('a failed save keeps the change on the device; a refresh reads the server again and reapplies only the change', async () => {
		let fail = true;
		const server = new Map<number, unknown>([[4, { version: 1, newLimit: 30, reviewLimit: 40 }]]);
		const local = memoryStorage();
		const save = vi.fn(async (ws: number, data: unknown) => {
			if (fail) throw new TypeError('Failed to fetch');
			server.set(ws, data);
		});
		const { store } = make({ save }, server, local);
		await store.update(4, { newLimit: 5 });
		expect(store.of(4).setup.newLimit).toBe(5);
		expect(store.of(4).saveError).toBeInstanceOf(TypeError);
		expect(JSON.parse(local.getItem(setupCacheKey(1, 4))!).pending).toEqual({ newLimit: 5 });

		// Meanwhile another device changed another member; then a reload of this one, back online.
		server.set(4, { version: 1, newLimit: 30, reviewLimit: 55 });
		fail = false;
		const again = make({ save }, server, local).store;
		expect(again.of(4).setup.newLimit).toBe(5);
		expect(again.of(4).saveError).not.toBeNull();
		await again.refresh(4);
		expect(server.get(4)).toMatchObject({ newLimit: 5, reviewLimit: 55 });
		expect(again.of(4)).toMatchObject({ saveError: null, loaded: true });
		expect(again.of(4).setup.reviewLimit).toBe(55);
		expect(JSON.parse(local.getItem(setupCacheKey(1, 4))!).pending).toBeNull();
	});

	it('a refusal of the server drops the change and says so; a busy server keeps it', async () => {
		const server = new Map<number, unknown>([[4, { version: 1, newLimit: 30 }]]);
		const refused = make({ save: vi.fn(async () => Promise.reject(new ApiError(413, JSON.stringify({ error: 'too_large', message: 'x' })))) }, server);
		await refused.store.update(4, { newLimit: 5 });
		expect(refused.store.of(4).setup.newLimit).toBe(30);
		expect(refused.store.of(4).saveError).toBeInstanceOf(ApiError);
		expect(JSON.parse(refused.local.getItem(setupCacheKey(1, 4))!).pending).toBeNull();

		const busy = make({ save: vi.fn(async () => Promise.reject(new ApiError(429, JSON.stringify({ error: 'rate_limited', message: 'x' })))) }, server);
		await busy.store.update(4, { newLimit: 5 });
		expect(busy.store.of(4).setup.newLimit).toBe(5);
		expect(JSON.parse(busy.local.getItem(setupCacheKey(1, 4))!).pending).toEqual({ newLimit: 5 });
	});

	it('a failed refresh keeps what is shown', async () => {
		const { store } = make({ load: vi.fn(async () => Promise.reject(new Error('offline'))) });
		await store.update(4, { newLimit: 5 });
		await store.refresh(4);
		expect(store.of(4).setup.newLimit).toBe(5);
	});

	it('an ended session writes nothing and stores nothing', async () => {
		const { store, deps, end, server } = make();
		server.set(4, { version: 1, newLimit: 30 });
		end();
		await store.refresh(4);
		await store.update(4, { newLimit: 5 });
		expect(deps.save).not.toHaveBeenCalled();
		expect(store.of(4).setup.newLimit).toBe(20);
	});

	it('a write that lands after its workspace was deleted leaves no cache behind (review nit)', async () => {
		let exists = true;
		const saving = deferred<void>();
		const { store, local } = make({ exists: () => exists, save: vi.fn(() => saving.promise) });
		const write = store.update(4, { newLimit: 5 });
		exists = false;
		local.removeItem(setupCacheKey(1, 4));
		saving.resolve();
		await write;
		expect(local.getItem(setupCacheKey(1, 4))).toBeNull();
	});

	it('forget removes every cached setup from the device', async () => {
		const { store, local } = make();
		await store.update(4, { newLimit: 5 });
		local.setItem('other', 'kept');
		store.forget();
		expect(local.getItem(setupCacheKey(1, 4))).toBeNull();
		expect(local.getItem('other')).toBe('kept');
	});
});

describe('setupCacheWorkspace', () => {
	it('reads the workspace of a cache key', () => {
		expect(setupCacheWorkspace(setupCacheKey(3, 17))).toBe(17);
		expect(setupCacheWorkspace('qinqin.study.setup.3')).toBeNull();
		expect(setupCacheWorkspace('qinqin.study.session')).toBeNull();
	});
});
