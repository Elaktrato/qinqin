// Review recording backed by a localStorage outbox. A review is the one
// study event that must never be lost: if the POST fails it stays
// queued (same ULID, so the server counts it once when it finally
// arrives) and is retried on boot and when the browser goes online.

import type { StudyEventBody } from '../api/types';
import { ApiError } from '../api/client';
import { postEvents } from '../events';
import { newUlid } from '../ulid';
import type { ReviewEvent, ReviewGrade } from './types';

/** localStorage key of the append-only pending review queue. */
export const PENDING_REVIEWS_KEY = 'qinqin.study.pending';

const DEVICE = 'web';

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
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

function readPending(): StudyEventBody[] {
	const store = storage();
	if (store === null) return [];
	try {
		const raw = store.getItem(PENDING_REVIEWS_KEY);
		if (raw === null) return [];
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isEventBody);
	} catch {
		// Corrupt data or denied storage: nothing can be retried.
		return [];
	}
}

function writePending(events: StudyEventBody[]): void {
	const store = storage();
	if (store === null) return;
	try {
		if (events.length === 0) {
			store.removeItem(PENDING_REVIEWS_KEY);
		} else {
			store.setItem(PENDING_REVIEWS_KEY, JSON.stringify(events));
		}
	} catch {
		// Storage unavailable (private mode): the queue stays empty.
	}
}

function enqueue(event: StudyEventBody): void {
	writePending([...readPending(), event]);
}

/**
 * recordReview appends one review event. It resolves even when the POST
 * fails; the event is then persisted to the pending queue instead.
 */
export async function recordReview(
	workspaceId: number,
	cardId: string,
	grade: ReviewGrade
): Promise<void> {
	const event: ReviewEvent = {
		id: newUlid(),
		workspaceId,
		device: DEVICE,
		ts: new Date().toISOString(),
		type: 'review',
		payload: { cardId, mode: 'vocab', grade }
	};

	try {
		await postEvents([event]);
	} catch (err) {
		enqueue(event);
		console.warn('review not recorded; queued for retry', err);
	}
}

/**
 * flushPendingReviews retries every queued review one event at a time.
 * A single bad row cannot wedge the outbox: a permanent 4xx (other than
 * 401/408/429, which are worth retrying) drops just that event, while
 * network errors and transient statuses keep it queued. Events keep
 * their original ULIDs, so an ambiguous retry is deduplicated by the
 * server. The function never throws.
 */
export async function flushPendingReviews(): Promise<void> {
	const queued = readPending();
	if (queued.length === 0) return;

	for (const event of queued) {
		try {
			await postEvents([event]);
			removePending(event.id);
		} catch (err) {
			if (isPermanentFailure(err)) {
				console.warn(`review event "${event.id}" rejected permanently; dropped`, err);
				removePending(event.id);
			} else {
				console.warn(`review event "${event.id}" not flushed; kept for retry`, err);
			}
		}
	}
}

function removePending(id: string): void {
	writePending(readPending().filter((event) => event.id !== id));
}

/**
 * A 4xx means the server will reject this row again; 401/408/429 and
 * non-HTTP failures are transient or auth-related and stay queued.
 */
function isPermanentFailure(err: unknown): boolean {
	if (!(err instanceof ApiError)) return false;
	if (err.status < 400 || err.status >= 500) return false;
	return err.status !== 401 && err.status !== 408 && err.status !== 429;
}

// Retry on the next connection and once when the app boots.
if (typeof window !== 'undefined') {
	window.addEventListener('online', () => {
		void flushPendingReviews();
	});
	void flushPendingReviews();
}
