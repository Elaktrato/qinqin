// Study-event recording: every event is an append-only row the server
// keys on a client-generated ULID. Recording is fire-and-forget — a
// failed POST must never break the page the user is on. The session's
// EventLog (record 0009) posts events and keeps the short-lived log cache
// the widgets share; the full-log read and the paths stay plain functions.

import { api, getToken } from '$lib/api/client';
import type { Api, Timers } from '$lib/context/deps';
import { firstEventsPageUrl, readEventLog } from './eventPages';
import { pruneSavedEventPages, type PageCachesLike } from '$lib/pwa/eventPageCache';
import { sessionPayload } from './eventPayloads';
import { LOG_CHANGING_TYPES } from '$lib/activity/sources';
import type { StudyEventBody } from '$lib/api/types';
import type { StudyDay } from '$lib/time/studyDay';
import { newUlid } from './ulid';
import { createWorkspaceCache, type WorkspaceCache } from '$lib/workspace/workspaceCache';

/** How long one event write may take before it counts as failed (a transient failure: the outbox retries it). */
export const EVENT_WRITE_TIMEOUT_MS = 20_000;

function timeoutSignal(ms: number): AbortSignal | undefined {
	return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

export type EventType = 'session' | 'view' | 'lookup' | 'review' | 'read' | 'journal' | 'script' | 'grammar' | 'course';

// StudyEvent is one event as GET /api/events serves it (an item of a page,
// lib/events/eventPages.ts): the row the
// server stored, with the caller's own timestamp stored as UTC whole
// seconds (fraction truncated; docs/contracts/events/).
export interface StudyEvent {
	id: string;
	workspaceId: number;
	device: string;
	ts: string;
	type: string;
	payload: unknown;
}

// The client id the server records for every event this app creates.
const DEVICE = 'web';

// How long a full event log read serves the widgets: one page and a
// Home -> Stats hop, not more. Joining the read in flight is the main gain.
export const WORKSPACE_EVENTS_TTL_MS = 8_000;

const EPOCH = '1970-01-01T00:00:00Z';

/** The first page of the whole event log of one workspace; the study load and offline preparation share it. */
export function fullLogPath(workspaceId: number): string {
	return firstEventsPageUrl({ since: EPOCH, workspace: workspaceId });
}

/**
 * fetchFullLog reads every page of one workspace's event log, uncached (#110).
 * A walk cut offline (a continuation neither the server nor the saved copy
 * has) gives the events read so far and `onIncomplete` is called; callers
 * treat it like any other offline copy. A complete walk drops the saved pages
 * no saved first page leads to any more (pwa/eventPageCache.ts).
 */
export async function fetchFullLog(
	workspaceId: number,
	onIncomplete: () => void = () => undefined
): Promise<StudyEvent[]> {
	const log = await readEventLog((path) => api<unknown>(path), { since: EPOCH, workspace: workspaceId });
	if (!log.complete) {
		console.warn(`event log of workspace ${workspaceId}: read offline up to a page that was not saved`);
		onIncomplete();
	} else {
		void pruneSavedEventPages(workspaceId, {
			caches: typeof caches === 'undefined' ? undefined : (caches as unknown as PageCachesLike),
			token: getToken()
		});
	}
	return log.events;
}

export interface EventLogDeps {
	api: Api;
	now(): number;
	timers: Timers;
	local(): Storage | null;
	/** The learner's day now (the session receipt is keyed by it). */
	studyDay(): StudyDay;
	/** Resolves once the learner's zone has loaded. */
	whenStudyDaySettled(): Promise<void>;
	/** How a reload of a held log ended (#290: false keeps the held log; the pages' quiet notice). */
	onRefresh?(workspaceId: number, ok: boolean): void;
}

/** SessionEndedError: the event log's session ended, so nothing more is sent. */
export class SessionEndedError extends Error {
	constructor() {
		super('the session ended: the event was not sent');
		this.name = 'SessionEndedError';
	}
}

/**
 * EventLog: the session's event posting and its short-lived cache of each
 * workspace's whole log (WORKSPACE_EVENTS_TTL_MS) shared by the home and Stats
 * widgets. A posted event whose type changes what the log shows drops that
 * workspace's cached log and tells the listeners.
 */
export class EventLog {
	readonly #deps: EventLogDeps;
	readonly #log: WorkspaceCache<StudyEvent[]>;
	readonly #listeners = new Set<(workspaceId: number) => void>();
	#disposed = false;

	constructor(deps: EventLogDeps) {
		this.#deps = deps;
		this.#log = createWorkspaceCache(
			// An incomplete log is not kept: the next read walks again.
			(workspaceId: number): Promise<StudyEvent[]> =>
				fetchFullLog(workspaceId, () => deps.timers.set(() => this.#log.invalidate(workspaceId), 0)),
			() => deps.now(),
			WORKSPACE_EVENTS_TTL_MS,
			{
				// A held log answers at once after its TTL or a post, and reloads behind (#290).
				revalidate: {
					changed: (held, fresh) => held.length !== fresh.length || held.some((event, i) => event.id !== fresh[i]?.id),
					refreshed: (workspaceId) => {
						if (!this.#disposed) this.#tell(workspaceId);
					},
					failed: (workspaceId) => {
						if (!this.#disposed) deps.onRefresh?.(workspaceId, false);
					},
					stored: (workspaceId) => {
						if (!this.#disposed) deps.onRefresh?.(workspaceId, true);
					}
				}
			}
		);
	}

	/**
	 * post sends a batch of already-built events. Unlike `record` it propagates
	 * failures so callers that must not lose an event (reviews) can put it in a
	 * retry queue.
	 */
	async post(events: StudyEventBody[]): Promise<void> {
		// The session ended: its events must not go out with the next user's token.
		if (this.#disposed) throw new SessionEndedError();
		try {
			// A request that never answers would pin a review that is only in memory
			// (or in flight in the outbox) for good: give up and let the retry take it.
			await this.#deps.api('/api/events/batch', { method: 'POST', body: { events }, signal: timeoutSignal(EVENT_WRITE_TIMEOUT_MS) });
		} finally {
			// A failed POST may still have landed: drop what may be stale either way.
			this.#changed(events);
		}
	}

	/**
	 * record appends one study event to the server log. Failures are logged to
	 * the console and swallowed: recording is telemetry, never page-breaking.
	 */
	async record(type: EventType, workspaceId: number, payload: unknown = null): Promise<void> {
		if (this.#disposed) return;
		const event: StudyEventBody = {
			id: newUlid(),
			workspaceId,
			device: DEVICE,
			ts: new Date(this.#deps.now()).toISOString(),
			type,
			payload
		};
		try {
			await this.post([event]);
		} catch (err) {
			console.warn(`study event "${type}" not recorded`, err);
		}
	}

	/**
	 * load reads the whole event log of one workspace through the short-lived
	 * shared cache: the home and Stats widgets each need it, and they share one
	 * read. A held log older than the TTL, or marked stale by a post, answers
	 * at once and reloads behind (#290; onChange tells when it changed).
	 * `force` skips a cached copy (a widget's "Try again"). The array is
	 * shared: do not mutate it. Pages that schedule or write study data read
	 * uncached (fetchFullLog).
	 */
	load(workspaceId: number, opts?: { force?: boolean }): Promise<StudyEvent[]> {
		return this.#log.get(workspaceId, opts);
	}

	/** invalidate drops the cached log of one workspace, or of all. */
	invalidate(workspaceId?: number): void {
		this.#log.invalidate(workspaceId);
	}

	/**
	 * onChange registers a listener called with the workspace whose log
	 * changed: a review or read event was posted (the held log is marked stale),
	 * or a reload behind a held log brought other events (#290). Returns the
	 * unsubscribe.
	 */
	onChange(listener: (workspaceId: number) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/**
	 * recordSessionOnce records one `session` event per workspace per learner
	 * day (the same boundary the heatmap buckets events by). The receipt is
	 * written to localStorage before the POST so two mounts in the same page
	 * (or a reload) cannot double-count the day; with storage unavailable the
	 * session is recorded every time, which is the safe direction.
	 */
	recordSessionOnce(workspaceId: number, day: StudyDay = this.#deps.studyDay(), now: number = this.#deps.now()): void {
		if (this.#disposed) return;
		const key = sessionKey(workspaceId, day.today(now));
		try {
			const storage = this.#deps.local();
			if (storage !== null) {
				if (storage.getItem(key) !== null) return;
				storage.setItem(key, '1');
			}
		} catch {
			// Storage unavailable (private mode): record without a receipt.
		}
		void this.record('session', workspaceId, sessionPayload());
	}

	/**
	 * recordSessionWhenSettled is recordSessionOnce after the learner's zone has
	 * loaded, so a receipt near midnight is not keyed by the provisional browser
	 * zone.
	 */
	async recordSessionWhenSettled(workspaceId: number): Promise<void> {
		await this.#deps.whenStudyDaySettled();
		this.recordSessionOnce(workspaceId);
	}

	/** dispose: the session ended; the cached logs and the listeners go. */
	dispose(): void {
		this.#disposed = true;
		this.#log.invalidate();
		this.#listeners.clear();
	}

	#changed(events: readonly StudyEventBody[]): void {
		const types = LOG_CHANGING_TYPES;
		const touched = new Set<number>();
		for (const event of events) {
			if (types.has(event.type)) touched.add(event.workspaceId);
		}
		for (const workspaceId of touched) {
			// The held log stays for the next read, which reloads it behind (#290);
			// the reviews just sent are merged from the outbox's recent list.
			this.#log.markStale(workspaceId);
			this.#tell(workspaceId);
		}
	}

	#tell(workspaceId: number): void {
		for (const listener of [...this.#listeners]) listener(workspaceId);
	}
}

function sessionKey(workspaceId: number, day: string): string {
	return `qinqin.session.${workspaceId}.${day}`;
}

/**
 * sinceDaysAgo returns the RFC 3339 instant `days` days before now —
 * the lower bound sent to GET /api/events for a fixed-size window.
 */
export function sinceDaysAgo(days: number): string {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	return since.toISOString();
}
