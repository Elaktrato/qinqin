// Review recording backed by a durable outbox (IndexedDB, outboxStore.ts). A
// review is the one study event that must never be lost: it is committed to
// the outbox BEFORE the POST (write-ahead), and removed once the server has
// it. A failed POST leaves it queued (same ULID, so the server counts it once
// when it finally arrives) and it is retried on boot and when the browser
// goes online.
// ReviewOutbox is owned by the session (record 0009): its timers and
// listeners stop when the session ends, and it only ever sends the
// session's own user's items with the session's token.

import type { StudyEventBody } from '../api/types';
import { ApiError, getToken, isRestrictionResponse, isWorkspaceGoneResponse } from '../api/client';
import type { EventSource, Timers, VisibilitySource } from '../context/deps';
import { t } from '../i18n';
import { newUlid, ulidTime } from '$lib/events/ulid';
import { flushable, settle, type OutboxItem } from './outbox';
import { createOutboxStore, OUTBOX_KEY_V2, type OutboxStore } from './outboxStore';
import type {
	ReviewEvent,
	ReviewGrade,
	ReviewMeta,
	ReviewPayload,
	StudyCardKind
} from './types';

/** The pre-v3 localStorage key of the queue; migrated into IndexedDB once (outboxStore.ts). */
export const PENDING_REVIEWS_KEY = OUTBOX_KEY_V2;

const DEVICE = 'web';

function isWorkspaceGone(err: unknown): boolean {
	return err instanceof ApiError && isWorkspaceGoneResponse(err.status, err.code);
}

/** A 401 (revoked or expired session) or a 403 restriction (password change, MFA enrolment). */
function isSessionProblem(err: unknown): boolean {
	return err instanceof ApiError && (err.status === 401 || isRestrictionResponse(err.status, err.code));
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

export const OUTBOX_POLL_MS = 60_000;

function backoffMs(run: number): number {
	return Math.min(OUTBOX_POLL_MS * 2 ** run, 10 * 60_000);
}

export interface OutboxDeps {
	/** POST /api/events/batch (lib/events/index.ts postEvents). */
	post(events: StudyEventBody[]): Promise<void>;
	local(): Storage | null;
	/** Where the queue lives; default: the localStorage array behind `local`. The session passes the IndexedDB store. */
	store?: OutboxStore;
	now(): number;
	timers: Timers;
	/** online events; null outside a browser. */
	window: EventSource | null;
	/** visibilitychange events; null outside a browser. */
	document: VisibilitySource | null;
	/** The session's user, null until `me` answered. */
	user(): number | null;
	/** The token the session holds (the app's auth). */
	token(): string | null;
	/** A one-line notice for the shell (the session's Notices). */
	notify(text: string): void;
	/** How many of the user's reviews wait (the offline banner). */
	setQueued(count: number): void;
	/** A flush emptied the queue ("All reviews sent."). */
	allSent(): void;
	/** Reviews just sent, kept for the history until the log has them (recentSent.ts). */
	rememberSent(userId: number, events: readonly StudyEventBody[]): void;
}

export class ReviewOutbox {
	readonly #deps: OutboxDeps;
	// One flush at a time: boot, reconnect, and a session load can all ask
	// for a retry, and sharing the promise keeps them from sending the same
	// queued event twice.
	#flushing: Promise<void> | null = null;
	// After a transient failure the one-minute poll waits (2, 4, 8... up to 10
	// minutes); explicit triggers (online, back to the app, sign-in) still try at once.
	#backoffUntil = 0;
	#failureRun = 0;
	#started = false;
	#disposed = false;
	#poll: unknown = null;
	readonly #stops: Array<() => void> = [];
	readonly #store: OutboxStore;
	// Event ids whose first POST (the write-ahead record) is in flight: a flush
	// does not send them again, and the offline banner does not count them.
	readonly #inFlight = new Set<string>();
	#ready: Promise<void> | null = null;

	constructor(deps: OutboxDeps) {
		this.#deps = deps;
		this.#store = deps.store ?? createOutboxStore({ indexedDB: null, local: deps.local });
	}

	/**
	 * ready resolves once the persistent queue is in memory (IndexedDB opened,
	 * a v2 localStorage queue migrated). Readers that must see queued reviews
	 * (the study history) await it; it never rejects.
	 */
	ready(): Promise<void> {
		this.#ready ??= this.#store.load().then(() => this.#refreshQueued());
		return this.#ready;
	}

	/** pendingReviews: the not yet sent events of `userId` in one workspace. */
	pendingReviews(userId: number, workspaceId: number): StudyEventBody[] {
		return flushable(this.#items(), userId)
			.map((item) => item.event)
			.filter((event) => event.workspaceId === workspaceId);
	}

	/** pendingCount: how many reviews of `userId` wait to be sent. */
	pendingCount(userId: number): number {
		return flushable(this.#items(), userId).length;
	}

	/** clearPending deletes `userId`'s unsent reviews (an explicit "sign out and delete them"). */
	clearPending(userId: number): Promise<void> {
		return this.#drop((item) => item.userId === userId);
	}

	/** dropWorkspace deletes every queued review of a deleted workspace, whoever queued it (a workspace id is global). */
	dropWorkspace(workspaceId: number): Promise<void> {
		return this.#drop((item) => item.event.workspaceId === workspaceId);
	}

	/**
	 * dropForRestore deletes the restoring user's items and unowned ones (a
	 * restore makes new workspace ids; another user's items stay). Returns how
	 * many it dropped.
	 */
	dropForRestore(userId: number): number {
		const doomed = this.#store.items().filter((item) => item.userId === userId || item.userId === null);
		void this.#drop((item) => item.userId === userId || item.userId === null);
		return doomed.length;
	}

	#drop(match: (item: OutboxItem) => boolean): Promise<void> {
		const ids = this.#store.items().filter(match).map((item) => item.event.id);
		const done = this.#store.remove(ids);
		this.#refreshQueued();
		return done;
	}

	/**
	 * recordReview appends one review event and resolves with it, posted or
	 * queued for retry (the session's Back names it, #131); null when it was
	 * not kept (its workspace was deleted). It never rejects.
	 */
	async recordReview(
		workspaceId: number,
		cardId: string,
		grade: ReviewGrade,
		mode: StudyCardKind = 'vocab',
		meta?: ReviewMeta
	): Promise<ReviewEvent | null> {
		const payload: ReviewPayload = { cardId, mode, grade };
		if (meta !== undefined) payload.meta = meta;
		return this.#record({
			id: newUlid(),
			workspaceId,
			device: DEVICE,
			ts: new Date(this.#deps.now()).toISOString(),
			type: 'review',
			payload
		});
	}

	/**
	 * recordReplacement records a changed grade (#131,
	 * docs/contracts/events/review-replace.json): a new review with a fresh id
	 * that copies the target's card, mode, meta, workspace and ts and names it
	 * in `replaces`. Recorded like any review (outbox on failure); the outbox
	 * item of the target is never touched.
	 */
	async recordReplacement(target: ReviewEvent, grade: ReviewGrade): Promise<ReviewEvent | null> {
		const payload: ReviewPayload = { cardId: target.payload.cardId, mode: target.payload.mode, grade };
		if (target.payload.meta !== undefined) payload.meta = target.payload.meta;
		payload.replaces = target.id;
		// The id must sort above the id it names (the family's greatest id
		// survives): never earlier than the target's time + 1 ms, whatever this
		// device's clock says.
		const after = ulidTime(target.id);
		const now = this.#deps.now();
		return this.#record({
			id: newUlid(after === null ? now : Math.max(now, after + 1)),
			workspaceId: target.workspaceId,
			device: DEVICE,
			ts: target.ts,
			type: 'review',
			payload
		});
	}

	/**
	 * flush retries every queued review one event at a time. A single bad row
	 * cannot wedge the outbox: a permanent 4xx (other than 401/408/429, which
	 * are worth retrying) drops just that event, while network errors and
	 * transient statuses keep it queued. Events keep their original ULIDs, so
	 * an ambiguous retry is deduplicated by the server. Without a user, with
	 * another tab's token, or after the session ended it sends nothing and
	 * keeps the queue. Never throws.
	 */
	flush(): Promise<void> {
		if (this.#flushing !== null) return this.#flushing;
		this.#flushing = this.#flushOnce().finally(() => {
			this.#flushing = null;
		});
		return this.#flushing;
	}

	/**
	 * start wires the queue to the tab: it flushes now and again whenever the
	 * browser comes back online or the app comes back to the front, and polls
	 * while reviews wait. The root layout calls it once the session may load
	 * the app. Idempotent: repeated calls only trigger a flush.
	 */
	start(): void {
		if (this.#disposed) return;
		if (!this.#started) {
			this.#started = true;
			const { window, document } = this.#deps;
			if (window !== null) {
				const online = (): void => void this.flush();
				window.addEventListener('online', online);
				this.#stops.push(() => window.removeEventListener('online', online));
			}
			if (document !== null) {
				// Coming back to the app (a phone woken from its pocket) is the best
				// moment to send what waited; hiding it stops the retry timer.
				const visible = (): void => {
					if (this.#visible()) void this.flush();
					void this.#store.load().then(() => this.#refreshQueued());
				};
				document.addEventListener('visibilitychange', visible);
				this.#stops.push(() => document.removeEventListener('visibilitychange', visible));
			}
		}
		void this.flush();
	}

	/** userKnown: `me` named the session's user after boot: drain their queue. */
	userKnown(): void {
		if (this.#started) void this.flush();
	}

	/** dispose: the session ended; listeners and the poll stop, nothing more is sent. */
	dispose(): void {
		this.#disposed = true;
		for (const stop of this.#stops.splice(0)) stop();
		this.#syncPolling(false);
	}

	#visible(): boolean {
		return this.#deps.document === null || this.#deps.document.visibilityState !== 'hidden';
	}

	/**
	 * #items is the queue as `user` may use it. With a known user it first
	 * settles it (unowned items adopted, other users' expired items removed) and
	 * stores the difference, per item.
	 */
	#items(): readonly OutboxItem[] {
		const items = this.#store.items();
		const user = this.#deps.user();
		if (user === null) return items;
		const next = settle(items, user, this.#deps.now());
		const kept = new Set(next.map((item) => item.event.id));
		const expired = items.filter((item) => !kept.has(item.event.id)).map((item) => item.event.id);
		if (expired.length > 0) void this.#store.remove(expired);
		const before = new Map(items.map((item) => [item.event.id, item]));
		for (const item of next) if (before.get(item.event.id)?.userId !== item.userId) void this.#store.put(item);
		return next;
	}

	/** Tells the offline banner how many of the user's reviews wait, and re-evaluates the retry timer. */
	#refreshQueued(): void {
		if (this.#disposed) return;
		const user = this.#deps.user();
		const waiting = user === null ? 0 : flushable(this.#items(), user).filter((item) => !this.#inFlight.has(item.event.id)).length;
		this.#deps.setQueued(waiting);
		this.#syncPolling(waiting > 0);
	}

	/**
	 * While reviews are queued and the page is visible, try again every minute
	 * (a reconnect the browser did not announce, a server that came back). No
	 * Background Sync: Safari and Firefox lack it and a worker cannot read this
	 * queue.
	 */
	#syncPolling(queued: boolean): void {
		const want = !this.#disposed && this.#started && queued && this.#visible();
		if (want && this.#poll === null) {
			this.#poll = this.#deps.timers.every(() => {
				if (this.#deps.now() >= this.#backoffUntil) void this.flush();
			}, OUTBOX_POLL_MS);
		} else if (!want && this.#poll !== null) {
			this.#deps.timers.stop(this.#poll);
			this.#poll = null;
		}
	}

	async #record(event: ReviewEvent): Promise<ReviewEvent | null> {
		// Write-ahead: the review is committed to the outbox before anything is
		// sent, so a kill or a hanging request cannot lose what the UI shows as saved.
		this.#inFlight.add(event.id);
		await this.#store.put({ userId: this.#deps.user(), queuedAt: new Date(this.#deps.now()).toISOString(), event });
		try {
			await this.#deps.post([event]);
			const owner = this.#deps.user();
			if (owner !== null) this.#deps.rememberSent(owner, [event]);
			// A crash before this delete is harmless: the server keeps an id once.
			void this.#store.remove([event.id]);
		} catch (err) {
			// The workspace was deleted elsewhere: a retry can never succeed.
			// The shell reloads the workspaces on the same 404 (workspaceGone.ts).
			if (isWorkspaceGone(err)) {
				console.warn('review not recorded; its workspace was deleted', err);
				void this.#store.remove([event.id]);
				this.#deps.notify(t('study.outbox.notSaved'));
				return null;
			}
			console.warn('review not recorded; queued for retry', err);
		} finally {
			this.#inFlight.delete(event.id);
			this.#refreshQueued();
		}
		return event;
	}

	async #flushOnce(): Promise<void> {
		// Signed out, ended, or `me` not answered yet: every POST would be a 401
		// or another user's, so the queue waits. The pair (user, token) is
		// captured once; if the stored token is another one than the session's
		// (a second tab signed in as someone else) this tab is stale: send nothing.
		const user = this.#deps.user();
		const token = getToken();
		const mine = (): boolean => !this.#disposed && getToken() === token && this.#deps.user() === user;
		if (this.#disposed || token === null || user === null || token !== this.#deps.token()) return;
		// Another tab may have queued or sent items since: read the store afresh.
		await this.#store.load();
		if (!mine()) return;
		const all = this.#items();
		this.#refreshQueued();
		const queued = flushable(all, user).filter((item) => !this.#inFlight.has(item.event.id));
		if (queued.length === 0) return;

		let gone = 0;
		let sent = 0;
		let failures = 0;
		for (const { event } of queued) {
			// Re-checked before every event: a sign-in elsewhere replaced the token.
			if (!mine()) break;
			try {
				await this.#deps.post([event]);
				this.#deps.rememberSent(user, [event]);
				sent++;
				this.#forget(event.id);
			} catch (err) {
				// The session is gone or restricted: every further POST would fail
				// the same way. Everything stays queued for this user's next full
				// session; another user never sends it.
				if (isSessionProblem(err)) {
					console.warn('review outbox paused: the session cannot send right now', err);
					break;
				}
				// A refusal only counts for this user while the request was theirs.
				if (!mine()) break;
				if (isPermanentFailure(err)) {
					if (isWorkspaceGone(err)) gone++;
					console.warn(`review event "${event.id}" rejected permanently; dropped`, err);
					this.#forget(event.id);
				} else {
					// Transient (network, 5xx, 429): the next events would fail the same
					// way. Stop and back off; the next trigger tries again.
					console.warn(`review event "${event.id}" not flushed; kept for retry`, err);
					failures++;
					break;
				}
			}
		}
		if (failures > 0) this.#backoffUntil = this.#deps.now() + backoffMs(++this.#failureRun);
		else {
			this.#failureRun = 0;
			this.#backoffUntil = 0;
		}
		// The session ended during the flush: the tab's banner and notices belong to the next one.
		if (this.#disposed) return;
		if (sent > 0 && this.pendingCount(user) === 0) this.#deps.allSent();
		// Reviews of a workspace deleted elsewhere are lost for good: say so.
		if (gone > 0) this.#deps.notify(t('study.outbox.queuedNotSaved', { count: gone }));
	}

	#forget(id: string): void {
		void this.#store.remove([id]);
		this.#refreshQueued();
	}
}
