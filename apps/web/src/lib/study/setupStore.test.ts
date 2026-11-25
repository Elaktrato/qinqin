import { describe, expect, it, vi } from 'vitest';
import { memoryStorage } from '$lib/testing/context';
import { defaultSetup, type StudySetup } from './setup';
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

function make(over: Partial<StudySetupsDeps> = {}) {
	const local = memoryStorage();
	const server = new Map<number, unknown>();
	let alive = true;
	const deps: StudySetupsDeps = {
		load: vi.fn(async (ws: number) => server.get(ws) ?? null),
		save: vi.fn(async (ws: number, data: unknown) => void server.set(ws, data)),
		local: () => local,
		user: () => 1,
		alive: () => alive,
		...over
	};
	return { store: new StudySetups(deps), deps, local, server, end: () => (alive = false) };
}

const twenty: StudySetup = { ...defaultSetup(), newLimit: 5 };

describe('StudySetups', () => {
	it('answers the defaults at once when nothing is known', () => {
		const { store } = make();
		expect(store.of(4)).toMatchObject({ setup: defaultSetup(), loaded: false, saveError: null });
	});

	it('answers the device cache at once, then the server', async () => {
		const { store, local, server } = make();
		local.setItem(setupCacheKey(1, 4), JSON.stringify({ raw: { version: 1, newLimit: 9 }, dirty: false }));
		server.set(4, { version: 1, newLimit: 12 });
		expect(store.of(4).setup.newLimit).toBe(9);
		await store.refresh(4);
		expect(store.of(4)).toMatchObject({ loaded: true });
		expect(store.of(4).setup.newLimit).toBe(12);
		expect(JSON.parse(local.getItem(setupCacheKey(1, 4))!).raw).toEqual({ version: 1, newLimit: 12 });
	});

	it("never reads another user's cache", () => {
		const { store, local } = make();
		local.setItem(setupCacheKey(2, 4), JSON.stringify({ raw: { version: 1, newLimit: 9 }, dirty: false }));
		expect(store.of(4).setup.newLimit).toBe(20);
	});

	it('an update paints at once and writes the stored row with the change, unknown members kept', async () => {
		const { store, server, deps } = make();
		server.set(4, { version: 1, future: { x: 1 } });
		const saving = store.update(4, twenty);
		expect(store.of(4).setup.newLimit).toBe(5);
		await saving;
		expect(deps.save).toHaveBeenCalledTimes(1);
		expect(server.get(4)).toMatchObject({ version: 1, future: { x: 1 }, newLimit: 5 });
		expect(store.of(4).saveError).toBeNull();
	});

	it('keeps each workspace apart', async () => {
		const { store, server } = make();
		await store.update(4, twenty);
		expect(server.get(5)).toBeUndefined();
		expect(store.of(5).setup.newLimit).toBe(20);
	});

	it('a load begun before an update never puts the old value back', async () => {
		const slow = deferred<unknown>();
		let calls = 0;
		const { store } = make({ load: vi.fn(() => (++calls === 1 ? slow.promise : Promise.resolve(null))) });
		const reading = store.refresh(4);
		await store.update(4, twenty);
		slow.resolve({ version: 1, newLimit: 50 });
		await reading;
		expect(store.of(4).setup.newLimit).toBe(5);
	});

	it('writes one after another, the last change last', async () => {
		const order: number[] = [];
		const { store } = make({ save: vi.fn(async (_ws: number, data: unknown) => void order.push((data as StudySetup).newLimit)) });
		await Promise.all([store.update(4, { ...twenty, newLimit: 6 }), store.update(4, { ...twenty, newLimit: 7 })]);
		expect(order).toEqual([6, 7]);
		expect(store.of(4).setup.newLimit).toBe(7);
	});

	it('a failed save keeps the change, says so, and the next refresh writes it again', async () => {
		let fail = true;
		const { store, server, local } = make({
			save: vi.fn(async (ws: number, data: unknown) => {
				if (fail) throw new Error('offline');
				server.set(ws, data);
			})
		});
		server.set(4, { version: 1, newLimit: 30 });
		await store.update(4, twenty);
		expect(store.of(4).setup.newLimit).toBe(5);
		expect(store.of(4).saveError).not.toBeNull();
		expect(JSON.parse(local.getItem(setupCacheKey(1, 4))!).dirty).toBe(true);

		// A reload: a new store from the same device cache.
		fail = false;
		const again = new StudySetups({ load: async (ws) => server.get(ws) ?? null, save: async (ws, d) => void server.set(ws, d), local: () => local, user: () => 1, alive: () => true });
		expect(again.of(4).setup.newLimit).toBe(5);
		await again.refresh(4);
		expect(server.get(4)).toMatchObject({ newLimit: 5 });
		expect(again.of(4)).toMatchObject({ saveError: null, loaded: true });
		expect(JSON.parse(local.getItem(setupCacheKey(1, 4))!).dirty).toBe(false);
	});

	it('a failed refresh keeps what is shown', async () => {
		const { store } = make({ load: vi.fn(async () => Promise.reject(new Error('offline'))) });
		await store.update(4, twenty).catch(() => undefined);
		await store.refresh(4);
		expect(store.of(4).setup.newLimit).toBe(5);
	});

	it('an ended session writes nothing and stores nothing', async () => {
		const { store, deps, end, server } = make();
		server.set(4, { version: 1, newLimit: 30 });
		end();
		await store.refresh(4);
		await store.update(4, twenty);
		expect(deps.save).not.toHaveBeenCalled();
		expect(store.of(4).setup.newLimit).toBe(20);
	});

	it('forget removes every cached setup from the device', async () => {
		const { store, local } = make();
		await store.update(4, twenty);
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
