// Review recording backed by a localStorage outbox. A review is the one
// study event that must never be lost: if the POST fails it stays
// queued (same ULID, so the server counts it once when it finally
// arrives) and is retried on boot and when the browser goes online.

import type { StudyEventBody } from '../api/types';
import { ApiError, getToken, isRestrictionResponse, isWorkspaceGoneResponse } from '../api/client';
import { showNotice } from '../notices';
import { postEvents } from '../events';
import { newUlid } from '../ulid';
import { notifyAllSent, setQueued } from '../pwa/offlineState';
import { flushable, settle, type OutboxItem, type OutboxState } from './outbox';
import { onOutboxUser, outboxUser } from './outboxUser';
import type {
	ReviewEvent,
	ReviewGrade,
	ReviewMeta,
	ReviewPayload,
	StudyCardKind
} from './types';

/** localStorage key of the per-user pending review queue (items {userId, queuedAt, event}). */
export const PENDING_REVIEWS_KEY = 'qinqin.study.pending.v2';
/** The pre-v2 queue (bare events, no owner): adopted by the first signed-in user, then removed. */
export const LEGACY_PENDING_KEY = 'qinqin.study.pending';

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

function isItem(value: unknown): value is OutboxItem {
	if (typeof value !== 'object' || value === null) return false;
	const item = value as Record<string, unknown>;
	return (
		(item.userId === null || typeof item.userId === 'number') &&
		typeof item.queuedAt === 'string' &&
		isEventBody(item.event)
	);
}

function readArray(key: string): unknown[] {
	const store = storage();
	if (store === null) return [];
	try {
		const raw = store.getItem(key);
		if (raw === null) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		// Corrupt data or denied storage: nothing can be retried.
		return [];
	}
}

function writeState(state: OutboxState): void {
	const store = storage();
	if (store === null) return;
	try {
		if (state.items.length === 0) store.removeItem(PENDING_REVIEWS_KEY);
		else store.setItem(PENDING_REVIEWS_KEY, JSON.stringify(state.items));
		if (state.legacy.length === 0) store.removeItem(LEGACY_PENDING_KEY);
		else store.setItem(LEGACY_PENDING_KEY, JSON.stringify(state.legacy));
	} catch {
		// Storage unavailable (private mode): the queue stays empty.
	}
}

/**
 * load reads the queue. With a known user it first settles it (legacy and
 * unowned items adopted, other users' expired items removed) and saves the
 * result; without one the legacy queue is left alone.
 */
function load(): OutboxItem[] {
	const state: OutboxState = {
		legacy: readArray(LEGACY_PENDING_KEY).filter(isEventBody),
		items: readArray(PENDING_REVIEWS_KEY).filter(isItem)
	};
	const user = outboxUser();
	if (user === null) return state.items;
	const next = settle(state, user, Date.now());
	if (state.legacy.length > 0 || JSON.stringify(next.items) !== JSON.stringify(state.items)) {
		writeState(next);
	}
	return next.items;
}

function save(items: OutboxItem[]): void {
	writeState({ legacy: readArray(LEGACY_PENDING_KEY).filter(isEventBody), items });
	refreshQueued(items);
}

/** Tells the offline banner how many of the signed-in user's reviews wait, and re-evaluates the retry timer. */
function refreshQueued(items: readonly OutboxItem[]): void {
	const user = outboxUser();
	setQueued(user === null ? 0 : flushable(items, user).length);
	syncPolling(user !== null && flushable(items, user).length > 0);
}

const POLL_MS = 60_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function pageVisible(): boolean {
	return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * While reviews are queued and the page is visible, try again every minute
 * (a reconnect the browser did not announce, a server that came back). No
 * Background Sync: Safari and Firefox lack it and a worker cannot read this
 * queue.
 */
function syncPolling(queued: boolean): void {
	const want = outboxStarted && queued && pageVisible();
	if (want && pollTimer === null) {
		pollTimer = setInterval(() => void flushPendingReviews(), POLL_MS);
	} else if (!want && pollTimer !== null) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

function enqueue(event: StudyEventBody): void {
	save([...load(), { userId: outboxUser(), queuedAt: new Date().toISOString(), event }]);
}

/** pendingReviews: the not yet sent events of `userId` in one workspace. */
export function pendingReviews(userId: number, workspaceId: number): StudyEventBody[] {
	return flushable(load(), userId)
		.map((item) => item.event)
		.filter((event) => event.workspaceId === workspaceId);
}

/** pendingCount: how many reviews of `userId` wait to be sent. */
export function pendingCount(userId: number): number {
	return flushable(load(), userId).length;
}

/** clearPending deletes `userId`'s unsent reviews (an explicit "sign out and delete them"). */
export function clearPending(userId: number): void {
	save(load().filter((item) => item.userId !== userId));
}

/**
 * recordReview appends one review event. It resolves even when the POST
 * fails; the event is then persisted to the pending queue instead.
 */
export async function recordReview(
	workspaceId: number,
	cardId: string,
	grade: ReviewGrade,
	mode: StudyCardKind = 'vocab',
	meta?: ReviewMeta
): Promise<void> {
	const payload: ReviewPayload = { cardId, mode, grade };
	if (meta !== undefined) payload.meta = meta;
	const event: ReviewEvent = {
		id: newUlid(),
		workspaceId,
		device: DEVICE,
		ts: new Date().toISOString(),
		type: 'review',
		payload
	};

	try {
		await postEvents([event]);
	} catch (err) {
		// The workspace was deleted elsewhere: a retry can never succeed.
		// The shell reloads the workspaces on the same 404 (workspaceGone.ts).
		if (isWorkspaceGone(err)) {
			console.warn('review not recorded; its workspace was deleted', err);
			showNotice('This review was not saved: its workspace was deleted.');
			return;
		}
		enqueue(event);
		console.warn('review not recorded; queued for retry', err);
	}
}

function isWorkspaceGone(err: unknown): boolean {
	return err instanceof ApiError && isWorkspaceGoneResponse(err.status, err.message);
}

// One flush at a time: boot, reconnect, and a session load can all ask
// for a retry, and sharing the promise keeps them from sending the same
// queued event twice.
let flushing: Promise<void> | null = null;
let outboxStarted = false;

/**
 * flushPendingReviews retries every queued review one event at a time.
 * A single bad row cannot wedge the outbox: a permanent 4xx (other than
 * 401/408/429, which are worth retrying) drops just that event, while
 * network errors and transient statuses keep it queued. Events keep
 * their original ULIDs, so an ambiguous retry is deduplicated by the
 * server. Signed out it sends nothing and keeps the queue. The function
 * never throws.
 */
export function flushPendingReviews(): Promise<void> {
	if (flushing !== null) return flushing;
	flushing = flushOnce().finally(() => {
		flushing = null;
	});
	return flushing;
}

async function flushOnce(): Promise<void> {
	// Signed out (an open page such as /sources, or a reconnect after
	// logout): every POST would be a 401, so the queue waits for the next
	// session instead. The same holds until `me` has told who is signed in:
	// only that user's items may be sent.
	const user = outboxUser();
	if (getToken() === null || user === null) return;
	const all = load();
	refreshQueued(all);
	const queued = flushable(all, user);
	if (queued.length === 0) return;

	let gone = 0;
	let sent = 0;
	for (const { event } of queued) {
		try {
			await postEvents([event]);
			sent++;
			removePending(event.id);
		} catch (err) {
			// The session is gone or restricted: every further POST would fail
			// the same way. Everything stays queued for this user's next full
			// session; another user never sends it.
			if (isSessionProblem(err)) {
				console.warn('review outbox paused: the session cannot send right now', err);
				break;
			}
			if (isPermanentFailure(err)) {
				if (isWorkspaceGone(err)) gone++;
				console.warn(`review event "${event.id}" rejected permanently; dropped`, err);
				removePending(event.id);
			} else {
				console.warn(`review event "${event.id}" not flushed; kept for retry`, err);
			}
		}
	}
	if (sent > 0 && pendingCount(user) === 0) notifyAllSent();
	// Reviews of a workspace deleted elsewhere are lost for good: say so.
	if (gone > 0) {
		showNotice(
			gone === 1
				? '1 queued review was not saved: its workspace was deleted.'
				: `${gone} queued reviews were not saved: their workspace was deleted.`
		);
	}
}

/** A 401 (revoked or expired session) or a 403 restriction (password change, MFA enrolment). */
function isSessionProblem(err: unknown): boolean {
	return err instanceof ApiError && (err.status === 401 || isRestrictionResponse(err.status, err.message));
}

function removePending(id: string): void {
	save(load().filter((item) => item.event.id !== id));
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

/**
 * startReviewOutbox wires the retry queue to the app shell: it flushes
 * once now and again whenever the browser comes back online. The root
 * layout calls it on mount, so a user who reopens the app on any route
 * — not just the session page — drains queued reviews. Idempotent: the
 * listener is installed once and repeated calls only trigger a flush,
 * which shares one in-flight promise.
 */
export function startReviewOutbox(): void {
	if (typeof window === 'undefined') return;
	if (!outboxStarted) {
		outboxStarted = true;
		window.addEventListener('online', () => {
			void flushPendingReviews();
		});
		// A user who becomes known after boot (me answered) drains their queue.
		onOutboxUser(() => void flushPendingReviews());
		// Coming back to the app (a phone woken from its pocket) is the best
		// moment to send what waited; hiding it stops the retry timer.
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', () => {
				if (pageVisible()) void flushPendingReviews();
				refreshQueued(load());
			});
		}
	}
	void flushPendingReviews();
}
