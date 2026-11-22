import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { get } from 'svelte/store';
import { dismissNotice, notice } from '../notices';
import {
	LEGACY_PENDING_KEY,
	PENDING_REVIEWS_KEY,
	clearPending,
	flushPendingReviews,
	pendingCount,
	pendingReviews,
	recordReplacement,
	recordReview,
	resetOutboxForTests,
	startReviewOutbox
} from './events';
import { setOutboxUser } from './outboxUser';
import { recentSentReviews } from './recentSent';
import { newUlid, ulidTime } from '../ulid';

beforeEach(() => {
	resetOutboxForTests();
	setOutboxUser(null, null);
});

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function fakeStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function lastBatch(): { events: Record<string, unknown>[] } {
	const calls = vi.mocked(fetch).mock.calls;
	const [, init] = calls[calls.length - 1];
	return JSON.parse(String(init?.body));
}

function pendingItems(): { userId: number | null; queuedAt: string; event: Record<string, unknown> }[] {
	const raw = localStorage.getItem(PENDING_REVIEWS_KEY);
	return raw === null ? [] : JSON.parse(raw);
}

// The queued events of every user, in queue order.
function pending(): Record<string, unknown>[] {
	return pendingItems().map((item) => item.event);
}

// Flatten every event sent across all batch calls, so a flush that sends
// one event per request and one that sends a single batch both read the
// same way.
function sentEvents(): Record<string, unknown>[] {
	return vi.mocked(fetch).mock.calls.flatMap(([, init]) => {
		const body = JSON.parse(String(init?.body)) as { events?: Record<string, unknown>[] };
		return body.events ?? [];
	});
}

describe('recordReview', () => {
	beforeEach(() => {
		setOutboxUser(1, 'secret');
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-03-15T08:30:00Z'));
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ accepted: 1, duplicates: 0 }));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('posts a review event with a ULID, timestamp and payload', async () => {
		await recordReview(7, 'card-1', 3);

		const [call] = vi.mocked(fetch).mock.calls;
		expect(String(call[0])).toBe('/api/events/batch');
		expect(call[1]?.method).toBe('POST');

		const [event] = lastBatch().events;
		expect(event).toMatchObject({
			workspaceId: 7,
			device: 'web',
			ts: '2026-03-15T08:30:00.000Z',
			type: 'review',
			payload: { cardId: 'card-1', mode: 'vocab', grade: 3 }
		});
		expect(event.id).toMatch(ULID);
	});

	it('writes the given mode and meta', async () => {
		const meta = { tier: 1 as const, mistakes: 2, hints: 1, durationMs: 4000 };
		await recordReview(7, 'card-1', 2, 'writing', meta);

		const [event] = lastBatch().events;
		expect(event.payload).toEqual({ cardId: 'card-1', mode: 'writing', grade: 2, meta });
	});

	it('defaults to vocab and omits meta when none is given', async () => {
		await recordReview(7, 'card-1', 3);

		const [event] = lastBatch().events;
		expect(event.payload).toEqual({ cardId: 'card-1', mode: 'vocab', grade: 3 });
	});

	it('does not enqueue a review the server accepted', async () => {
		await recordReview(7, 'card-1', 4);

		expect(pending()).toEqual([]);
	});

	it('enqueues a failed review and never rejects', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));

		const queuedEvent = await recordReview(7, 'card-1', 1);

		const attempted = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).events[0];
		const queued = pending();
		expect(queued).toHaveLength(1);
		expect(queued[0].id).toBe(attempted.id);
		expect(queued[0]).toMatchObject({ type: 'review', workspaceId: 7 });
		// The queued event is the one handed back (#131: Back names it).
		expect(queuedEvent).toEqual(queued[0]);
	});

	it('does not queue a review of a deleted workspace, and says so', async () => {
		dismissNotice();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.mocked(fetch).mockResolvedValue(new Response('workspace not found', { status: 404 }));

		await expect(recordReview(7, 'card-1', 2)).resolves.toBeNull();

		expect(pending()).toEqual([]);
		expect(get(notice)).toBe('This review was not saved: its workspace was deleted.');
		warn.mockRestore();
	});

	it('enqueues on a non-2xx response too', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));

		await expect(recordReview(7, 'card-1', 2)).resolves.toMatchObject({ type: 'review' });
		expect(pending()).toHaveLength(1);
	});

	it('never throws when storage is unavailable', async () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
			removeItem: () => {
				throw new Error('denied');
			}
		});
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));

		await expect(recordReview(7, 'card-1', 3)).resolves.toMatchObject({ type: 'review' });
		await expect(flushPendingReviews()).resolves.toBeUndefined();
	});

	it('resolves with the event it posted', async () => {
		const event = await recordReview(7, 'card-1', 3, 'tone', { mistakes: 1 });

		expect(event).toEqual(lastBatch().events[0]);
	});
});

describe('recordReplacement (#131)', () => {
	beforeEach(() => {
		setOutboxUser(1, 'secret');
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn());
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-03-15T08:35:00Z'));
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ accepted: 1, duplicates: 0 }));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	const target = {
		id: '01KAPZ00000000000000000001',
		workspaceId: 7,
		device: 'web',
		ts: '2026-03-15T08:30:00.123Z',
		type: 'review' as const,
		payload: { cardId: 'card-1', mode: 'writing' as const, grade: 1 as const, meta: { mistakes: 3, durationMs: 9000 } }
	};

	it("copies the target's card, mode, meta and ts and names it", async () => {
		const event = await recordReplacement(target, 3);

		const [sent] = lastBatch().events;
		expect(sent).toEqual(event);
		expect(sent).toMatchObject({
			workspaceId: 7,
			device: 'web',
			ts: '2026-03-15T08:30:00.123Z',
			type: 'review',
			payload: {
				cardId: 'card-1',
				mode: 'writing',
				grade: 3,
				meta: { mistakes: 3, durationMs: 9000 },
				replaces: '01KAPZ00000000000000000001'
			}
		});
		expect(sent.id).toMatch(ULID);
		expect(sent.id).not.toBe(target.id);
	});

	it('omits meta when the target had none', async () => {
		const { meta: _meta, ...payload } = target.payload;
		await recordReplacement({ ...target, payload }, 2);

		expect(lastBatch().events[0].payload).toEqual({ cardId: 'card-1', mode: 'writing', grade: 2, replaces: target.id });
	});

	it('sorts above its target even when the device clock is behind it (#131)', async () => {
		// The target was made one hour "later" than this device's clock now reads.
		const ahead = newUlid(Date.parse('2026-03-15T09:35:00Z'));
		const event = await recordReplacement({ ...target, id: ahead }, 3);

		expect(event!.id > ahead).toBe(true);
		expect(ulidTime(event!.id)).toBe(ulidTime(ahead)! + 1);
	});

	it('uses the clock when it is ahead of its target', async () => {
		const event = await recordReplacement(target, 3);

		expect(ulidTime(event!.id)).toBe(Date.parse('2026-03-15T08:35:00Z'));
	});

	it('is queued like a review when the POST fails', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));

		const event = await recordReplacement(target, 3);

		expect(pending()).toEqual([event]);
	});
});

describe('flushPendingReviews', () => {
	beforeEach(() => {
		setOutboxUser(1, 'secret');
		vi.stubGlobal('localStorage', fakeStorage());
		localStorage.setItem('qinqin.token', 'secret');
		vi.stubGlobal('fetch', vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('retries queued events with their original ULIDs and clears them', async () => {
		vi.mocked(fetch)
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new Error('offline'));

		await recordReview(7, 'card-1', 3);
		await recordReview(7, 'card-2', 4);

		const queued = pending();
		expect(queued).toHaveLength(2);
		const ids = queued.map((event) => event.id);

		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockImplementation(async () =>
			jsonResponse({ accepted: 1, duplicates: 0 })
		);
		await flushPendingReviews();

		expect(sentEvents().map((event) => event.id)).toEqual(ids);
		expect(pending()).toEqual([]);
	});

	it('drops one permanently rejected event without blocking the rest', async () => {
		vi.mocked(fetch)
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new Error('offline'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recordReview(7, 'card-1', 3);
		await recordReview(7, 'card-2', 4);
		const ids = pending().map((event) => event.id);

		vi.mocked(fetch).mockClear();
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response('bad payload', { status: 400 }))
			.mockResolvedValueOnce(jsonResponse({ accepted: 1, duplicates: 0 }));
		await flushPendingReviews();

		expect(pending()).toEqual([]);
		expect(sentEvents().map((event) => event.id)).toEqual(ids);
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});

	it('sends nothing and keeps the queue while signed out', async () => {
		vi.mocked(fetch)
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new Error('offline'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recordReview(7, 'card-1', 3);
		await recordReview(7, 'card-2', 4);
		localStorage.removeItem('qinqin.token');

		vi.mocked(fetch).mockClear();
		await flushPendingReviews();

		expect(fetch).not.toHaveBeenCalled();
		expect(pending()).toHaveLength(2);
		warn.mockRestore();
	});

	it('keeps every event queued on a network failure', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recordReview(7, 'card-1', 3);
		await recordReview(7, 'card-2', 4);
		await flushPendingReviews();

		expect(pending()).toHaveLength(2);
		warn.mockRestore();
	});

	it('drops a 404 event for one workspace without blocking another workspace', async () => {
		vi.mocked(fetch)
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new Error('offline'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recordReview(5, 'card-1', 3);
		await recordReview(9, 'card-2', 4);
		const ids = pending().map((event) => event.id);

		vi.mocked(fetch).mockClear();
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response('no such workspace', { status: 404 }))
			.mockResolvedValueOnce(jsonResponse({ accepted: 1, duplicates: 0 }));
		await flushPendingReviews();

		expect(pending()).toEqual([]);
		expect(sentEvents().map((event) => event.id)).toEqual(ids);
		warn.mockRestore();
	});

	it('says how many queued reviews were dropped because their workspace was deleted', async () => {
		vi.mocked(fetch)
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new Error('offline'))
			.mockRejectedValueOnce(new Error('offline'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await recordReview(5, 'card-1', 3);
		await recordReview(5, 'card-2', 3);
		await recordReview(9, 'card-3', 4);
		dismissNotice();

		vi.mocked(fetch).mockClear();
		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response('workspace not found', { status: 404 }))
			.mockResolvedValueOnce(new Response('workspace not found', { status: 404 }))
			.mockResolvedValueOnce(jsonResponse({ accepted: 1, duplicates: 0 }));
		await flushPendingReviews();

		expect(pending()).toEqual([]);
		expect(get(notice)).toBe('2 queued reviews were not saved: their workspace was deleted.');
		warn.mockRestore();
	});

	it('says nothing when no queued review was dropped for a deleted workspace', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await recordReview(5, 'card-1', 3);
		dismissNotice();

		vi.mocked(fetch).mockResolvedValueOnce(new Response('bad payload', { status: 400 }));
		await flushPendingReviews();

		expect(get(notice)).toBeNull();
		warn.mockRestore();
	});

	it('keeps an event queued on a retryable 5xx and on 429', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		await recordReview(7, 'card-1', 3);

		vi.mocked(fetch)
			.mockResolvedValueOnce(new Response('boom', { status: 503 }))
			.mockResolvedValueOnce(new Response('slow down', { status: 429 }));
		await flushPendingReviews();
		expect(pending()).toHaveLength(1);

		await flushPendingReviews();
		expect(pending()).toHaveLength(1);
		warn.mockRestore();
	});

	it('is idempotent: a second flush sends nothing', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		await recordReview(7, 'card-1', 3);

		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ accepted: 1, duplicates: 0 }));
		await flushPendingReviews();
		await flushPendingReviews();

		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('keeps the queue when the retry also fails', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));

		await recordReview(7, 'card-1', 3);
		await flushPendingReviews();

		expect(pending()).toHaveLength(1);
	});

	it('does nothing without a queue', async () => {
		await flushPendingReviews();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('recovers from malformed stored data', async () => {
		localStorage.setItem(PENDING_REVIEWS_KEY, 'not json');
		localStorage.setItem(LEGACY_PENDING_KEY, '{"oops"');

		await expect(flushPendingReviews()).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('shares one in-flight flush between concurrent callers', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		await recordReview(7, 'card-1', 3);

		vi.mocked(fetch).mockClear();
		let release: (response: Response) => void = () => {};
		vi.mocked(fetch).mockImplementation(
			() =>
				new Promise<Response>((resolve) => {
					release = resolve;
				})
		);

		const first = flushPendingReviews();
		const second = flushPendingReviews();
		expect(second).toBe(first);

		release(jsonResponse({ accepted: 1, duplicates: 0 }));
		await Promise.all([first, second]);
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(pending()).toEqual([]);
	});
});

describe('startReviewOutbox', () => {
	beforeEach(() => setOutboxUser(1, 'secret'));
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('is callable and safe without a window, storage, or fetch', () => {
		vi.stubGlobal('localStorage', undefined);
		vi.stubGlobal('fetch', vi.fn());

		expect(() => startReviewOutbox()).not.toThrow();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('installs the online listener once and drains the queue', async () => {
		vi.stubGlobal('localStorage', fakeStorage());
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ accepted: 1, duplicates: 0 })));
		const addEventListener = vi.fn();
		vi.stubGlobal('window', { addEventListener });
		localStorage.setItem(
			LEGACY_PENDING_KEY,
			JSON.stringify([
				{
					id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
					workspaceId: 7,
					device: 'web',
					ts: '2026-03-15T08:30:00.000Z',
					type: 'review',
					payload: { cardId: 'card-1', mode: 'vocab', grade: 3 }
				}
			])
		);

		localStorage.setItem('qinqin.token', 'secret');
		startReviewOutbox();
		startReviewOutbox();
		await flushPendingReviews();

		expect(addEventListener).toHaveBeenCalledTimes(1);
		expect(addEventListener).toHaveBeenCalledWith('online', expect.any(Function));
		expect(pending()).toEqual([]);
	});
});


describe('outbox per user', () => {
	beforeEach(() => {
		setOutboxUser(1, 'secret');
		vi.stubGlobal('localStorage', fakeStorage());
		localStorage.setItem('qinqin.token', 'secret');
		vi.stubGlobal('fetch', vi.fn());
		vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		setOutboxUser(null, null);
	});

	// Signing in as `user` replaces the stored token and the outbox user together.
	function signInAs(user: number): void {
		localStorage.setItem('qinqin.token', `tok${user}`);
		setOutboxUser(user, `tok${user}`);
	}

	async function queueAs(user: number, ws: number, card: string): Promise<void> {
		signInAs(user);
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		await recordReview(ws, card, 3);
	}

	it('stores the owner and the queue time with each queued review', async () => {
		await queueAs(5, 7, 'c1');
		const [item] = pendingItems();
		expect(item.userId).toBe(5);
		expect(Number.isNaN(Date.parse(item.queuedAt))).toBe(false);
		expect(localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
	});

	it("never sends another user's reviews; the owner's next session sends them", async () => {
		await queueAs(1, 7, 'a1');
		const aId = pending()[0].id;
		signInAs(2);
		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ accepted: 1, duplicates: 0 }));
		await flushPendingReviews();
		expect(fetch).not.toHaveBeenCalled();
		expect(pending()).toHaveLength(1);

		signInAs(1);
		await flushPendingReviews();
		expect(sentEvents().map((e) => e.id)).toEqual([aId]);
		expect(pending()).toEqual([]);
	});

	it('a tab whose token was replaced by another user sends nothing and drops nothing', async () => {
		// Tab 1: A is signed in and has a queue.
		await queueAs(1, 7, 'a1');
		await queueAs(1, 7, 'a2');
		// Tab 2 signs in as B: the shared localStorage token changes, tab 1 does not know yet.
		localStorage.setItem('qinqin.token', 'tokB');
		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockResolvedValue(new Response('workspace not found', { status: 404 }));
		await flushPendingReviews(); // the poll fires in tab 1
		expect(fetch).not.toHaveBeenCalled();
		expect(pending()).toHaveLength(2);
	});

	it('a token replaced during the flush stops it; a 404 for the new user never drops the old owner\'s review', async () => {
		await queueAs(1, 7, 'a1');
		await queueAs(1, 7, 'a2');
		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockImplementation(async () => {
			localStorage.setItem('qinqin.token', 'tokB');
			return new Response('workspace not found', { status: 404 });
		});
		await flushPendingReviews();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(pending()).toHaveLength(2);
	});

	it('stops at the first transient failure instead of hammering the server', async () => {
		await queueAs(1, 7, 'a1');
		await queueAs(1, 7, 'a2');
		await queueAs(1, 7, 'a3');
		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 503 }));
		await flushPendingReviews();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(pending()).toHaveLength(3);
	});

	it('sends nothing before a user is known', async () => {
		await queueAs(1, 7, 'a1');
		setOutboxUser(null, null);
		vi.mocked(fetch).mockClear();
		await flushPendingReviews();
		expect(fetch).not.toHaveBeenCalled();
		expect(pending()).toHaveLength(1);
	});

	it('adopts the legacy queue for the first signed-in user and removes the key', async () => {
		localStorage.setItem(
			LEGACY_PENDING_KEY,
			JSON.stringify([{ id: 'L1', workspaceId: 7, device: 'web', ts: '2026-03-15T08:30:00.000Z', type: 'review', payload: {} }])
		);
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));
		await flushPendingReviews();
		expect(localStorage.getItem(LEGACY_PENDING_KEY)).toBeNull();
		expect(pendingItems().map((i) => [i.userId, i.event.id])).toEqual([[1, 'L1']]);
	});

	it('stops at a 401 and keeps every item for the same user\'s next sign-in', async () => {
		await queueAs(1, 7, 'a1');
		await queueAs(1, 7, 'a2');
		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockResolvedValue(new Response('unauthorized', { status: 401 }));
		await flushPendingReviews();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(pending()).toHaveLength(2);
	});

	it('keeps reviews when the session is restricted (403 password_change_required) and stops', async () => {
		await queueAs(1, 7, 'a1');
		await queueAs(1, 7, 'a2');
		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: 'password_change_required' }), { status: 403 })
		);
		await flushPendingReviews();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(pending()).toHaveLength(2);
	});

	it('still drops an ordinary permanent 403', async () => {
		await queueAs(1, 7, 'a1');
		vi.mocked(fetch).mockResolvedValue(new Response('forbidden', { status: 403 }));
		await flushPendingReviews();
		expect(pending()).toEqual([]);
	});

	it('pendingReviews and pendingCount are per user and workspace', async () => {
		await queueAs(1, 7, 'a1');
		await queueAs(1, 8, 'a2');
		await queueAs(2, 7, 'b1');
		expect(pendingReviews(1, 7).map((e) => (e.payload as { cardId: string }).cardId)).toEqual(['a1']);
		expect(pendingReviews(2, 8)).toEqual([]);
		expect(pendingCount(1)).toBe(2);
		expect(pendingCount(2)).toBe(1);
	});

	it('clearPending removes only that user\'s items', async () => {
		await queueAs(1, 7, 'a1');
		await queueAs(2, 7, 'b1');
		clearPending(1);
		expect(pendingItems().map((i) => i.userId)).toEqual([2]);
	});

	it('removes expired items of other users when the next user flushes', async () => {
		localStorage.setItem(
			PENDING_REVIEWS_KEY,
			JSON.stringify([
				{ userId: 9, queuedAt: '2020-01-01T00:00:00.000Z', event: { id: 'old', workspaceId: 7, device: 'web', ts: 't', type: 'review', payload: {} } }
			])
		);
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ accepted: 1, duplicates: 0 }));
		await flushPendingReviews();
		expect(pending()).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('sent reviews are remembered for the offline history', () => {
	beforeEach(() => {
		setOutboxUser(1, 'secret');
		vi.stubGlobal('localStorage', fakeStorage());
		localStorage.setItem('qinqin.token', 'secret');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ accepted: 1, duplicates: 0 })));
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		setOutboxUser(null, null);
	});

	it('a review that was accepted at once is kept in the recent list', async () => {
		await recordReview(7, 'card-1', 3);
		const [event] = recentSentReviews(1, 7);
		expect((event.payload as { cardId: string }).cardId).toBe('card-1');
	});

	it('a queued review is remembered when the flush sends it, not before', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		await recordReview(7, 'card-2', 3);
		expect(recentSentReviews(1, 7)).toEqual([]);
		await flushPendingReviews();
		expect(recentSentReviews(1, 7)).toHaveLength(1);
	});
});
