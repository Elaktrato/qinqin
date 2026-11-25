// Where the review outbox keeps its items (docs/contracts/pwa/outbox-v3.json).
//
// IndexedDB, one record per review keyed by the event id, so that (1) an item
// is committed to disk when `put` resolves (`durability: 'strict'`; the old
// localStorage copy was flushed by Chromium late, and a force-stop within
// seconds of a grade lost reviews the UI had shown as saved) and (2) two tabs
// add and remove records without rewriting each other's (no whole-array lost
// update). The synchronous readers (pending counts, the offline banner, the
// study history) read an in-memory mirror, which `load` refreshes from the
// store.
//
// Where IndexedDB is missing or refuses (private mode, a blocked database) the
// store falls back to the v2 localStorage array and, with no storage at all, to
// memory for this session: reviews are still queued and retried, just not as
// durable. Nothing here ever rejects: a store that cannot persist keeps the
// mirror and says so through `kind`.

import type { OutboxItem } from './outbox';
import type { StudyEventBody } from '../api/types';

/** The pre-v3 queue: a JSON array in localStorage. Migrated once, then removed. */
export const OUTBOX_KEY_V2 = 'qinqin.study.pending.v2';
export const OUTBOX_DB = 'qinqin-outbox';
const OUTBOX_STORE = 'items';

export type OutboxStoreKind = 'indexedDB' | 'localStorage';

export interface OutboxStore {
	readonly kind: OutboxStoreKind;
	/** The queue, oldest first. Synchronous: the mirror. */
	items(): readonly OutboxItem[];
	/** Re-reads the persistent copy into the mirror (another tab's changes; the first call also migrates v2). */
	load(): Promise<void>;
	/** Adds or replaces the item by its event id; resolves once it is committed (or cannot be). */
	put(item: OutboxItem): Promise<void>;
	/** Removes the items with these event ids. */
	remove(ids: readonly string[]): Promise<void>;
}

export interface OutboxStoreDeps {
	/** The IndexedDB factory; null where there is none. */
	indexedDB: IDBFactory | null;
	local(): Storage | null;
}

function isEventBody(value: unknown): value is StudyEventBody {
	if (typeof value !== 'object' || value === null) return false;
	const event = value as Record<string, unknown>;
	return (
		typeof event.id === 'string' &&
		typeof event.workspaceId === 'number' &&
		typeof event.ts === 'string' &&
		typeof event.type === 'string'
	);
}

export function isOutboxItem(value: unknown): value is OutboxItem {
	if (typeof value !== 'object' || value === null) return false;
	const item = value as Record<string, unknown>;
	return (
		(item.userId === null || typeof item.userId === 'number') &&
		typeof item.queuedAt === 'string' &&
		isEventBody(item.event)
	);
}

/** Queue order: by queue time, then event id (a ULID: a replacement sorts above its target). */
function byQueue(a: OutboxItem, b: OutboxItem): number {
	if (a.queuedAt !== b.queuedAt) return a.queuedAt < b.queuedAt ? -1 : 1;
	return a.event.id < b.event.id ? -1 : a.event.id > b.event.id ? 1 : 0;
}

function sorted(items: Iterable<OutboxItem>): OutboxItem[] {
	return [...items].sort(byQueue);
}

/** The localStorage array of the v2 contract; with no usable storage, memory. */
class LocalStore implements OutboxStore {
	readonly kind = 'localStorage';
	readonly #local: () => Storage | null;
	#memory: OutboxItem[] = [];

	constructor(local: () => Storage | null) {
		this.#local = local;
	}

	/** Adds the items whose event ids the queue does not hold yet. */
	adopt(items: readonly OutboxItem[]): void {
		const all = [...this.items()];
		const known = new Set(all.map((item) => item.event.id));
		const fresh = items.filter((item) => !known.has(item.event.id));
		if (fresh.length > 0) this.#write([...all, ...fresh]);
	}

	items(): readonly OutboxItem[] {
		const read = this.#read();
		if (read !== null) this.#memory = read;
		return this.#memory;
	}

	async load(): Promise<void> {
		this.items();
	}

	put(item: OutboxItem): Promise<void> {
		const all = [...this.items()];
		const at = all.findIndex((existing) => existing.event.id === item.event.id);
		if (at >= 0) all[at] = item;
		else all.push(item);
		this.#write(all);
		return Promise.resolve();
	}

	remove(ids: readonly string[]): Promise<void> {
		const drop = new Set(ids);
		const all = this.items();
		const kept = all.filter((item) => !drop.has(item.event.id));
		if (kept.length !== all.length) this.#write(kept);
		return Promise.resolve();
	}

	/** null: no readable storage (the memory copy is the queue). */
	#read(): OutboxItem[] | null {
		try {
			const store = this.#local();
			if (store === null) return null;
			const raw = store.getItem(OUTBOX_KEY_V2);
			if (raw === null) return [];
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? parsed.filter(isOutboxItem) : [];
		} catch {
			return null;
		}
	}

	#write(items: OutboxItem[]): void {
		this.#memory = items;
		try {
			const store = this.#local();
			if (store === null) return;
			if (items.length === 0) store.removeItem(OUTBOX_KEY_V2);
			else store.setItem(OUTBOX_KEY_V2, JSON.stringify(items));
		} catch {
			// Storage unavailable (private mode): the queue lives in memory.
		}
	}
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
	});
}

/** Resolves when the transaction is committed to disk; rejects when it aborts. */
function committed(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('indexedDB transaction failed'));
		tx.onabort = () => reject(tx.error ?? new Error('indexedDB transaction aborted'));
	});
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = factory.open(OUTBOX_DB, 1);
		req.onupgradeneeded = () => {
			// Keyed by the event id: the server's idempotency key is the record's key.
			req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'event.id' });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
		req.onblocked = () => reject(new Error('indexedDB open blocked'));
	});
}

class IdbStore implements OutboxStore {
	readonly #factory: IDBFactory;
	readonly #local: () => Storage | null;
	#db: Promise<IDBDatabase> | null = null;
	#mirror = new Map<string, OutboxItem>();
	// Changes made to the mirror whose transaction has not completed: a load
	// that read the store earlier must not undo them.
	readonly #inFlight = new Map<string, { item: OutboxItem | null }>();
	#fallback: LocalStore | null = null;
	#migrated = false;

	constructor(factory: IDBFactory, local: () => Storage | null) {
		this.#factory = factory;
		this.#local = local;
	}

	get kind(): OutboxStoreKind {
		return this.#fallback === null ? 'indexedDB' : 'localStorage';
	}

	items(): readonly OutboxItem[] {
		return this.#fallback !== null ? this.#fallback.items() : sorted(this.#mirror.values());
	}

	async load(): Promise<void> {
		if (this.#fallback !== null) return this.#fallback.load();
		try {
			const db = await this.#connect();
			if (!this.#migrated) {
				this.#migrated = true;
				await this.#migrate(db);
			}
			const read = await request(db.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE).getAll());
			const next = new Map<string, OutboxItem>();
			for (const value of read as unknown[]) if (isOutboxItem(value)) next.set(value.event.id, value);
			for (const [id, change] of this.#inFlight) {
				if (change.item === null) next.delete(id);
				else next.set(id, change.item);
			}
			this.#mirror = next;
		} catch (err) {
			this.#degrade(err);
		}
	}

	put(item: OutboxItem): Promise<void> {
		if (this.#fallback !== null) return this.#fallback.put(item);
		return this.#change(item.event.id, item, (store) => void store.put(item));
	}

	async remove(ids: readonly string[]): Promise<void> {
		if (this.#fallback !== null) return this.#fallback.remove(ids);
		const present = ids.filter((id) => this.#mirror.has(id) || this.#inFlight.has(id));
		if (present.length === 0) return;
		await Promise.all(present.map((id) => this.#change(id, null, (store) => void store.delete(id))));
	}

	#connect(): Promise<IDBDatabase> {
		this.#db ??= open(this.#factory);
		return this.#db;
	}

	async #change(id: string, item: OutboxItem | null, apply: (store: IDBObjectStore) => void): Promise<void> {
		const change = { item };
		this.#inFlight.set(id, change);
		if (item === null) this.#mirror.delete(id);
		else this.#mirror.set(id, item);
		try {
			const db = await this.#connect();
			const tx = db.transaction(OUTBOX_STORE, 'readwrite', { durability: 'strict' });
			apply(tx.objectStore(OUTBOX_STORE));
			await committed(tx);
		} catch (err) {
			this.#degrade(err);
		} finally {
			if (this.#inFlight.get(id) === change) this.#inFlight.delete(id);
		}
	}

	/** v2 localStorage items move into the store in one committed transaction; then the key goes. */
	async #migrate(db: IDBDatabase): Promise<void> {
		let raw: string | null = null;
		try {
			raw = this.#local()?.getItem(OUTBOX_KEY_V2) ?? null;
		} catch {
			return;
		}
		if (raw === null) return;
		let old: OutboxItem[] = [];
		try {
			const parsed: unknown = JSON.parse(raw);
			if (Array.isArray(parsed)) old = parsed.filter(isOutboxItem);
		} catch {
			// Corrupt: nothing can be retried; the key is removed below.
		}
		if (old.length > 0) {
			const tx = db.transaction(OUTBOX_STORE, 'readwrite', { durability: 'strict' });
			const store = tx.objectStore(OUTBOX_STORE);
			for (const item of old) {
				// An id already in the store is the newer copy.
				const existing = await request(store.getKey(item.event.id));
				if (existing === undefined) store.put(item);
			}
			await committed(tx);
		}
		try {
			this.#local()?.removeItem(OUTBOX_KEY_V2);
		} catch {
			// Left behind: the next start migrates the same ids again, harmlessly.
		}
	}

	/** The database failed: the queue goes on in the localStorage array, seeded with the mirror. */
	#degrade(err: unknown): void {
		if (this.#fallback !== null) return;
		console.warn('review outbox: IndexedDB unavailable; using localStorage', err);
		const fallback = new LocalStore(this.#local);
		fallback.adopt(sorted(this.#mirror.values()));
		this.#fallback = fallback;
	}
}

export function createOutboxStore(deps: OutboxStoreDeps): OutboxStore {
	return deps.indexedDB === null ? new LocalStore(deps.local) : new IdbStore(deps.indexedDB, deps.local);
}
