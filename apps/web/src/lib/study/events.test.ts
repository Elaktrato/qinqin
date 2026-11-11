import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));

vi.mock('$app/navigation', () => ({ goto }));

import { PENDING_REVIEWS_KEY, flushPendingReviews, recordReview } from './events';

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

function pending(): Record<string, unknown>[] {
	const raw = localStorage.getItem(PENDING_REVIEWS_KEY);
	return raw === null ? [] : (JSON.parse(raw) as Record<string, unknown>[]);
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

	it('does not enqueue a review the server accepted', async () => {
		await recordReview(7, 'card-1', 4);

		expect(pending()).toEqual([]);
	});

	it('enqueues a failed review and never rejects', async () => {
		vi.mocked(fetch).mockRejectedValue(new Error('offline'));

		await expect(recordReview(7, 'card-1', 1)).resolves.toBeUndefined();

		const attempted = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).events[0];
		const queued = pending();
		expect(queued).toHaveLength(1);
		expect(queued[0].id).toBe(attempted.id);
		expect(queued[0]).toMatchObject({ type: 'review', workspaceId: 7 });
	});

	it('enqueues on a non-2xx response too', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response('boom', { status: 500 }));

		await expect(recordReview(7, 'card-1', 2)).resolves.toBeUndefined();
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

		await expect(recordReview(7, 'card-1', 3)).resolves.toBeUndefined();
		await expect(flushPendingReviews()).resolves.toBeUndefined();
	});
});

describe('flushPendingReviews', () => {
	beforeEach(() => {
		vi.stubGlobal('localStorage', fakeStorage());
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

		await expect(flushPendingReviews()).resolves.toBeUndefined();
		expect(fetch).not.toHaveBeenCalled();
	});
});
