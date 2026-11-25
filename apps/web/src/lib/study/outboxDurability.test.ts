// The review outbox on IndexedDB (docs/contracts/pwa/outbox-v3.json): write-ahead
// before the POST, committed before "saved", deleted after the server has it,
// and exactly-once in effect because the server keeps an event id once.

import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { browserTimers } from '../context/deps';
import type { StudyEventBody } from '../api/types';
import { ReviewOutbox } from './events';
import type { OutboxItem } from './outbox';
import { OUTBOX_DB, OUTBOX_KEY_V2, createOutboxStore } from './outboxStore';

let factory: IDBFactory;
let local: Map<string, string>;
const storage = (): Storage =>
	({
		getItem: (k: string) => local.get(k) ?? null,
		setItem: (k: string, v: string) => void local.set(k, v),
		removeItem: (k: string) => void local.delete(k),
		clear: () => local.clear(),
		key: (i: number) => [...local.keys()][i] ?? null,
		get length() {
			return local.size;
		}
	}) as Storage;

/** The server: it stores an event id once (accepted / duplicates). */
let stored: Set<string>;
let accepted: number;
let post: (events: StudyEventBody[]) => Promise<void>;
let allSent = 0;
let queued = -1;

function outboxOn(db: IDBFactory, user: number | null = 1): ReviewOutbox {
	return new ReviewOutbox({
		post: (events) => post(events),
		local: storage,
		store: createOutboxStore({ indexedDB: db, local: storage }),
		now: () => Date.now(),
		timers: browserTimers,
		window: null,
		document: null,
		user: () => user,
		token: () => 'tok',
		notify: () => undefined,
		setQueued: (n) => void (queued = n),
		allSent: () => void allSent++,
		rememberSent: () => undefined
	});
}

async function persisted(db: IDBFactory = factory): Promise<OutboxItem[]> {
	const conn = await new Promise<IDBDatabase>((resolve, reject) => {
		const open = db.open(OUTBOX_DB);
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
	const all = await new Promise<OutboxItem[]>((resolve) => {
		const req = conn.transaction('items').objectStore('items').getAll();
		req.onsuccess = () => resolve(req.result as OutboxItem[]);
	});
	conn.close();
	return all;
}

beforeEach(() => {
	factory = new IDBFactory();
	local = new Map();
	stored = new Set();
	accepted = 0;
	allSent = 0;
	queued = -1;
	vi.stubGlobal('localStorage', storage());
	local.set('qinqin.token', 'tok');
	post = async (events) => {
		for (const event of events) {
			if (!stored.has(event.id)) {
				stored.add(event.id);
				accepted++;
			}
		}
	};
	vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('write-ahead', () => {
	it('the review is committed before the POST starts', async () => {
		const outbox = outboxOn(factory);
		await outbox.ready();
		let seenAtPost: OutboxItem[] = [];
		post = async () => {
			seenAtPost = await persisted();
			throw new TypeError('offline');
		};
		const event = await outbox.recordReview(7, 'c1', 3);
		expect(seenAtPost.map((i) => i.event.id)).toEqual([event!.id]);
	});

	it('a hanging POST leaves the review durable (and out of the offline count)', async () => {
		const outbox = outboxOn(factory);
		await outbox.ready();
		post = () => new Promise<void>(() => undefined);
		void outbox.recordReview(7, 'c1', 3);
		await vi.waitFor(async () => expect(await persisted()).toHaveLength(1));
		expect(outbox.pendingReviews(1, 7)).toHaveLength(1);
		expect(queued).toBe(0);
	});

	it('a restart after a kill finds the review and sends it once', async () => {
		const first = outboxOn(factory);
		await first.ready();
		post = () => new Promise<void>(() => undefined); // killed while the request hangs
		void first.recordReview(7, 'c1', 3);
		await vi.waitFor(async () => expect(await persisted()).toHaveLength(1));

		post = async (events) => {
			for (const e of events) if (!stored.has(e.id)) (stored.add(e.id), accepted++);
		};
		const second = outboxOn(factory);
		second.start();
		await vi.waitFor(async () => expect(await persisted()).toHaveLength(0));
		expect(accepted).toBe(1);
		expect(allSent).toBe(1);
	});

	it('a success leaves nothing behind', async () => {
		const outbox = outboxOn(factory);
		await outbox.ready();
		await outbox.recordReview(7, 'c1', 3);
		await vi.waitFor(async () => expect(await persisted()).toEqual([]));
		expect(accepted).toBe(1);
	});

	it('a crash between the POST and the delete counts once: the retry is a duplicate', async () => {
		const first = outboxOn(factory);
		await first.ready();
		// The server has it, but the delete never ran (the page died after the answer).
		const event = await first.recordReview(7, 'c1', 3);
		await vi.waitFor(async () => expect(await persisted()).toEqual([]));
		const item: OutboxItem = { userId: 1, queuedAt: new Date().toISOString(), event: event! };
		const seeder = createOutboxStore({ indexedDB: factory, local: storage });
		await seeder.load();
		await seeder.put(item);

		const second = outboxOn(factory);
		await second.flush();
		expect(accepted).toBe(1);
		expect(stored.size).toBe(1);
		await vi.waitFor(async () => expect(await persisted()).toEqual([]));
	});

	it('a workspace gone is dropped from the store and reported as not saved', async () => {
		const outbox = outboxOn(factory);
		await outbox.ready();
		post = async () => {
			throw new ApiError(404, JSON.stringify({ error: 'workspace_not_found', message: 'gone' }));
		};
		await expect(outbox.recordReview(7, 'c1', 3)).resolves.toBeNull();
		await vi.waitFor(async () => expect(await persisted()).toEqual([]));
	});

	it('a failed POST keeps the item for the retry', async () => {
		const outbox = outboxOn(factory);
		await outbox.ready();
		post = async () => {
			throw new TypeError('offline');
		};
		await outbox.recordReview(7, 'c1', 3);
		expect(await persisted()).toHaveLength(1);
		expect(queued).toBe(1);
		post = async (events) => {
			for (const e of events) if (!stored.has(e.id)) (stored.add(e.id), accepted++);
		};
		await outbox.flush();
		expect(accepted).toBe(1);
		await vi.waitFor(async () => expect(await persisted()).toEqual([]));
	});

	it('a flush does not send a review whose first POST is still in flight', async () => {
		const outbox = outboxOn(factory);
		await outbox.ready();
		let calls = 0;
		post = () => {
			calls++;
			return new Promise<void>(() => undefined);
		};
		void outbox.recordReview(7, 'c1', 3);
		await vi.waitFor(() => expect(calls).toBe(1));
		await outbox.flush();
		expect(calls).toBe(1);
	});
});

describe('migration and clearing', () => {
	function v2Item(id: string, userId: number | null = 1): OutboxItem {
		return { userId, queuedAt: '2026-11-25T08:00:00.000Z', event: { id, workspaceId: 7, device: 'web', ts: '2026-11-25T08:00:00.000Z', type: 'review', payload: {} } };
	}

	it('moves the v2 localStorage queue into the store once and sends it', async () => {
		local.set(OUTBOX_KEY_V2, JSON.stringify([v2Item('A'), v2Item('B')]));
		const outbox = outboxOn(factory);
		await outbox.ready();
		expect(local.has(OUTBOX_KEY_V2)).toBe(false);
		expect(outbox.pendingCount(1)).toBe(2);
		await outbox.flush();
		expect(accepted).toBe(2);
		await vi.waitFor(async () => expect(await persisted()).toEqual([]));
	});

	it('clearPending, dropWorkspace and dropForRestore delete from the store', async () => {
		const seeder = createOutboxStore({ indexedDB: factory, local: storage });
		await seeder.load();
		await seeder.put(v2Item('A', 1));
		await seeder.put(v2Item('B', 2));
		await seeder.put({ ...v2Item('C', 2), event: { ...v2Item('C').event, workspaceId: 9 } });
		const outbox = outboxOn(factory, 1);
		await outbox.ready();
		await outbox.clearPending(1);
		expect((await persisted()).map((i) => i.event.id)).toEqual(['B', 'C']);
		await outbox.dropWorkspace(9);
		expect((await persisted()).map((i) => i.event.id)).toEqual(['B']);
		await seeder.load();
		await seeder.put(v2Item('D', null));
		await outbox.ready();
		await outbox.flush(); // reads the store afresh; user 1 adopts D and sends it
		expect(accepted).toBe(1);
	});
});
