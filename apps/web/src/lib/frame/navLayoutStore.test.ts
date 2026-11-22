import { describe, expect, it, vi } from 'vitest';
import type { NavLayout } from './navLayout';
import { createNavLayoutStore, NAV_LAYOUT_CACHE_KEY } from './navLayoutStore.svelte';

function memoryStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (k) => map.get(k) ?? null,
		key: (i) => [...map.keys()][i] ?? null,
		removeItem: (k) => void map.delete(k),
		setItem: (k, v) => void map.set(k, String(v))
	};
}

const drawer: NavLayout = { phone: 'drawer', bar: ['reader'] };

describe('navLayoutStore', () => {
	it('starts on the defaults, loads the user row, and caches it per user', async () => {
		const storage = memoryStorage();
		const store = createNavLayoutStore({ load: async () => drawer, storage: () => storage, now: () => 0 });
		expect(store.phone).toBe('bar');
		await store.setUser(7);
		expect(store.layout).toEqual(drawer);
		expect(JSON.parse(storage.getItem(NAV_LAYOUT_CACHE_KEY)!)).toEqual({ user: 7, layout: drawer });
	});

	it('paints the cached value at once for the same user, never for another', async () => {
		const storage = memoryStorage();
		storage.setItem(NAV_LAYOUT_CACHE_KEY, JSON.stringify({ user: 7, layout: drawer }));
		const never = new Promise<NavLayout>(() => {});
		const same = createNavLayoutStore({ load: () => never, storage: () => storage, now: () => 0 });
		void same.setUser(7);
		expect(same.phone).toBe('drawer');
		const other = createNavLayoutStore({ load: () => never, storage: () => storage, now: () => 0 });
		void other.setUser(8);
		expect(other.phone).toBe('bar');
	});

	it('a failed load keeps what is painted', async () => {
		const storage = memoryStorage();
		storage.setItem(NAV_LAYOUT_CACHE_KEY, JSON.stringify({ user: 7, layout: drawer }));
		const store = createNavLayoutStore({ load: () => Promise.reject(new Error('offline')), storage: () => storage });
		await store.setUser(7);
		expect(store.layout).toEqual(drawer);
	});

	it('a value saved while a load is in flight wins over the slower load', async () => {
		let answer: (v: NavLayout) => void = () => {};
		const store = createNavLayoutStore({
			load: () => new Promise((resolve) => (answer = resolve)),
			storage: () => null,
			now: () => 0
		});
		const loading = store.setUser(7);
		store.set(drawer);
		answer({ phone: 'bar', bar: [] });
		await loading;
		expect(store.layout).toEqual(drawer);
	});

	it('signing out forgets the value in memory and on the device', async () => {
		const storage = memoryStorage();
		const store = createNavLayoutStore({ load: async () => drawer, storage: () => storage, now: () => 0 });
		await store.setUser(7);
		await store.setUser(null);
		expect(store.phone).toBe('bar');
		expect(storage.getItem(NAV_LAYOUT_CACHE_KEY)).toBeNull();
	});

	it('resume re-reads the row, at most once a minute', async () => {
		let now = 0;
		const load = vi.fn(async () => drawer);
		const store = createNavLayoutStore({ load, storage: () => null, now: () => now });
		await store.setUser(7);
		await store.resume();
		expect(load).toHaveBeenCalledTimes(1);
		now = 61_000;
		await store.resume();
		expect(load).toHaveBeenCalledTimes(2);
	});
});
