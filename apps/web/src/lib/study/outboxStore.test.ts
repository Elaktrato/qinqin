import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import type { OutboxItem } from './outbox';
import { OUTBOX_DB, OUTBOX_KEY_V2, createOutboxStore } from './outboxStore';

function item(id: string, userId: number | null = 1, queuedAt = '2026-11-25T08:00:00.000Z'): OutboxItem {
	return {
		userId,
		queuedAt,
		event: { id, workspaceId: 7, device: 'web', ts: queuedAt, type: 'review', payload: { cardId: 'c', mode: 'vocab', grade: 3 } }
	};
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
	const data = new Map(Object.entries(initial));
	return {
		get length() {
			return data.size;
		},
		clear: () => data.clear(),
		getItem: (k) => data.get(k) ?? null,
		key: (i) => [...data.keys()][i] ?? null,
		removeItem: (k) => void data.delete(k),
		setItem: (k, v) => void data.set(k, String(v))
	};
}

/** Every record of the store, read through a second connection (what another tab sees). */
async function persisted(factory: IDBFactory): Promise<OutboxItem[]> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const open = factory.open(OUTBOX_DB);
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
	const all = await new Promise<OutboxItem[]>((resolve, reject) => {
		const req = db.transaction('items').objectStore('items').getAll();
		req.onsuccess = () => resolve(req.result as OutboxItem[]);
		req.onerror = () => reject(req.error);
	});
	db.close();
	return all;
}

describe('IndexedDB outbox store', () => {
	it('put resolves only once the record is committed, and the mirror answers at once', async () => {
		const factory = new IDBFactory();
		const store = createOutboxStore({ indexedDB: factory, local: () => null });
		await store.load();
		const pending = store.put(item('A'));
		expect(store.items().map((i) => i.event.id)).toEqual(['A']);
		await pending;
		expect((await persisted(factory)).map((i) => i.event.id)).toEqual(['A']);
	});

	it('keeps one record per event id (a repeat put replaces)', async () => {
		const factory = new IDBFactory();
		const store = createOutboxStore({ indexedDB: factory, local: () => null });
		await store.load();
		await store.put(item('A', null));
		await store.put(item('A', 2));
		expect(store.items()).toHaveLength(1);
		expect((await persisted(factory)).map((i) => i.userId)).toEqual([2]);
	});

	it('remove deletes only the named records', async () => {
		const factory = new IDBFactory();
		const store = createOutboxStore({ indexedDB: factory, local: () => null });
		await store.load();
		await store.put(item('A'));
		await store.put(item('B'));
		await store.remove(['A']);
		expect(store.items().map((i) => i.event.id)).toEqual(['B']);
		expect((await persisted(factory)).map((i) => i.event.id)).toEqual(['B']);
	});

	it('a new instance (a restart) finds what an older one committed, oldest first', async () => {
		const factory = new IDBFactory();
		const first = createOutboxStore({ indexedDB: factory, local: () => null });
		await first.load();
		await first.put(item('B', 1, '2026-11-25T09:00:00.000Z'));
		await first.put(item('A', 1, '2026-11-25T08:00:00.000Z'));
		const second = createOutboxStore({ indexedDB: factory, local: () => null });
		await second.load();
		expect(second.items().map((i) => i.event.id)).toEqual(['A', 'B']);
	});

	it('two tabs add and remove per record: no lost update', async () => {
		const factory = new IDBFactory();
		const tab1 = createOutboxStore({ indexedDB: factory, local: () => null });
		const tab2 = createOutboxStore({ indexedDB: factory, local: () => null });
		await tab1.load();
		await tab2.load();
		await Promise.all([tab1.put(item('A')), tab2.put(item('B'))]);
		await tab1.remove(['A']);
		await tab2.load();
		expect(tab2.items().map((i) => i.event.id)).toEqual(['B']);
		await tab1.load();
		expect(tab1.items().map((i) => i.event.id)).toEqual(['B']);
	});

	it('a load racing a put keeps the put in the mirror', async () => {
		const factory = new IDBFactory();
		const store = createOutboxStore({ indexedDB: factory, local: () => null });
		await store.load();
		const loading = store.load();
		const putting = store.put(item('A'));
		await Promise.all([loading, putting]);
		expect(store.items().map((i) => i.event.id)).toEqual(['A']);
	});

	it('migrates the v2 localStorage queue once and removes the key', async () => {
		const factory = new IDBFactory();
		const local = memoryStorage({ [OUTBOX_KEY_V2]: JSON.stringify([item('A'), item('B', 2), { junk: true }]) });
		const store = createOutboxStore({ indexedDB: factory, local: () => local });
		await store.load();
		expect(store.items().map((i) => i.event.id)).toEqual(['A', 'B']);
		expect(local.getItem(OUTBOX_KEY_V2)).toBeNull();
		expect((await persisted(factory)).map((i) => i.event.id)).toEqual(['A', 'B']);
		// A second start finds nothing to migrate and changes nothing.
		const again = createOutboxStore({ indexedDB: factory, local: () => local });
		await again.load();
		expect(again.items()).toHaveLength(2);
	});

	it('falls back to localStorage when IndexedDB is missing', async () => {
		const local = memoryStorage();
		const store = createOutboxStore({ indexedDB: null, local: () => local });
		await store.load();
		await store.put(item('A'));
		expect(JSON.parse(local.getItem(OUTBOX_KEY_V2)!)).toHaveLength(1);
		await store.remove(['A']);
		expect(local.getItem(OUTBOX_KEY_V2)).toBeNull();
		expect(store.kind).toBe('localStorage');
	});

	it('falls back to localStorage when opening the database fails, keeping the queue', async () => {
		const broken = {
			open() {
				const req = {} as IDBOpenDBRequest;
				queueMicrotask(() => req.onerror?.(new Event('error')));
				return req;
			}
		} as unknown as IDBFactory;
		const local = memoryStorage({ [OUTBOX_KEY_V2]: JSON.stringify([item('A')]) });
		const store = createOutboxStore({ indexedDB: broken, local: () => local });
		await store.load();
		expect(store.items().map((i) => i.event.id)).toEqual(['A']);
		await store.put(item('B'));
		expect(JSON.parse(local.getItem(OUTBOX_KEY_V2)!)).toHaveLength(2);
		expect(store.kind).toBe('localStorage');
	});

	it('keeps the queue in memory when nothing can persist, and never rejects', async () => {
		const store = createOutboxStore({ indexedDB: null, local: () => null });
		await store.load();
		await store.put(item('A'));
		expect(store.items()).toHaveLength(1);
		await store.remove(['A']);
		expect(store.items()).toHaveLength(0);
	});
});
