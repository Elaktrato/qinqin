// Study-event recording: every event is an append-only row the server
// keys on a client-generated ULID. Recording is fire-and-forget — a
// failed POST must never break the page the user is on. The session's
// EventLog (record 0009) posts events and keeps the short-lived log cache
// the widgets share; the full-log read and the paths stay plain functions.

import { api, getToken } from './api/client';
import type { Api, Timers } from './context/deps';
import { firstEventsPageUrl, readEventLog } from './eventPages';
import { pruneSavedEventPages, type PageCachesLike } from './pwa/eventPageCache';
import { sessionPayload } from './eventPayloads';
import { logChangingTypes } from './plugins/contract';
import type { StudyEventBody } from './api/types';
import type { StudyDay } from './time/studyDay';
import { newUlid } from './ulid';
import { createWorkspaceCache, type WorkspaceCache } from './workspaceCache';

export type EventType = 'session' | 'view' | 'lookup' | 'review' | 'read' | 'journal';

// StudyEvent is one event as GET /api/events serves it (an item of a page,
// lib/eventPages.ts): the row the
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
	/** The registered plugins' manifests (their event types change the log too); null before they loaded. */
	manifests(): readonly unknown[] | null;
	/** The learner's day now (the session receipt is keyed by it). */
	studyDay(): StudyDay;
	/** Resolves once the learner's zone has loaded. */
	whenStudyDaySettled(): Promise<void>;
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

	constructor(deps: EventLogDeps) {
		this.#deps = deps;
		this.#log = createWorkspaceCache(
			// An incomplete log is not kept: the next read walks again.
			(workspaceId: number): Promise<StudyEvent[]> =>
				fetchFullLog(workspaceId, () => deps.timers.set(() => this.#log.invalidate(workspaceId), 0)),
			() => deps.now(),
			WORKSPACE_EVENTS_TTL_MS
		);
	}

	/**
	 * post sends a batch of already-built events. Unlike `record` it propagates
	 * failures so callers that must not lose an event (reviews) can put it in a
	 * retry queue.
	 */
	async post(events: StudyEventBody[]): Promise<void> {
		try {
			await this.#deps.api('/api/events/batch', { method: 'POST', body: { events } });
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
	 * read. `force` skips a cached copy (a widget's "Try again"). The array is
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
	 * onChange registers a listener called with the workspace whose cached log
	 * was dropped because a review or read event was posted, so caches derived
	 * from the log can drop theirs; returns the unsubscribe.
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
		this.#log.invalidate();
		this.#listeners.clear();
	}

	#changed(events: readonly StudyEventBody[]): void {
		const types = logChangingTypes(this.#deps.manifests());
		const touched = new Set<number>();
		for (const event of events) {
			if (types.has(event.type)) touched.add(event.workspaceId);
		}
		for (const workspaceId of touched) {
			this.#log.invalidate(workspaceId);
			for (const listener of [...this.#listeners]) listener(workspaceId);
		}
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
