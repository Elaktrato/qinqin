// Study-event recording: every event is an append-only row the server
// keys on a client-generated ULID. Recording is fire-and-forget — a
// failed POST must never break the page the user is on.

import { api } from './api/client';
import type { StudyEventBody } from './api/types';
import { newUlid } from './ulid';
import { createWorkspaceCache } from './workspaceCache';

export type EventType = 'session' | 'view' | 'lookup' | 'review' | 'read';

// StudyEvent is one event as GET /api/events serves it: the row the
// server stored, with the caller's own timestamp kept verbatim.
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

// UTC day keys sort the once-per-day session receipts: `YYYY-MM-DD` is
// the same boundary the heatmap buckets events by.
function utcDayKey(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/**
 * postEvents sends a batch of already-built events. Unlike `record` it
 * propagates failures so callers that must not lose an event (reviews)
 * can put it in a retry queue.
 */
export async function postEvents(events: StudyEventBody[]): Promise<void> {
	try {
		await api('/api/events/batch', {
			method: 'POST',
			body: { events }
		});
	} finally {
		// A failed POST may still have landed: drop what may be stale either way.
		logChanged(events);
	}
}

// How long a full event log read serves the widgets: one page and a
// Home -> Stats hop, not more. Joining the read in flight is the main gain.
export const WORKSPACE_EVENTS_TTL_MS = 8_000;

// Only these event types change what the readers of the full log show
// (reviews: flashcards, words, characters; read: reading time). The home
// page posts a `session` event on every load; dropping the cache for it
// would defeat the cache.
const LOG_CHANGING_TYPES: ReadonlySet<string> = new Set(['review', 'read']);

function fullLogPath(workspaceId: number): string {
	return `/api/events?since=1970-01-01T00:00:00Z&workspace=${workspaceId}`;
}

const eventLog = createWorkspaceCache(
	async (workspaceId: number): Promise<StudyEvent[]> => {
		const events = await api<StudyEvent[]>(fullLogPath(workspaceId));
		return Array.isArray(events) ? events : [];
	},
	() => Date.now(),
	WORKSPACE_EVENTS_TTL_MS
);

const logListeners = new Set<(workspaceId: number) => void>();

/**
 * onEventLogChange registers a listener called with the workspace whose
 * cached log was dropped because a review or read event was posted, so
 * caches derived from the log can drop theirs; returns the unsubscribe.
 */
export function onEventLogChange(listener: (workspaceId: number) => void): () => void {
	logListeners.add(listener);
	return () => logListeners.delete(listener);
}

function logChanged(events: readonly StudyEventBody[]): void {
	const touched = new Set<number>();
	for (const event of events) {
		if (LOG_CHANGING_TYPES.has(event.type)) touched.add(event.workspaceId);
	}
	for (const workspaceId of touched) {
		eventLog.invalidate(workspaceId);
		for (const listener of logListeners) listener(workspaceId);
	}
}

/**
 * loadWorkspaceEvents reads the whole event log of one workspace through
 * a short-lived shared cache (see WORKSPACE_EVENTS_TTL_MS): the home and
 * Stats widgets each need it, and they share one read. `force` skips a
 * cached copy (a widget's "Try again"). The array is shared: do not
 * mutate it. Pages that schedule or write study data read uncached.
 */
export function loadWorkspaceEvents(
	workspaceId: number,
	opts?: { force?: boolean }
): Promise<StudyEvent[]> {
	return eventLog.get(workspaceId, opts);
}

/** invalidateWorkspaceEvents drops the cached log of one workspace, or of all. */
export function invalidateWorkspaceEvents(workspaceId?: number): void {
	eventLog.invalidate(workspaceId);
}

/**
 * record appends one study event to the server log. Failures are
 * logged to the console and swallowed: recording is telemetry, never
 * page-breaking.
 */
export async function record(
	type: EventType,
	workspaceId: number,
	payload: unknown = null
): Promise<void> {
	const event: StudyEventBody = {
		id: newUlid(),
		workspaceId,
		device: DEVICE,
		ts: new Date().toISOString(),
		type,
		payload
	};

	try {
		await postEvents([event]);
	} catch (err) {
		console.warn(`study event "${type}" not recorded`, err);
	}
}

function sessionKey(workspaceId: number, day: string): string {
	return `qinqin.session.${workspaceId}.${day}`;
}

/**
 * recordSessionOnce records one `session` event per workspace per UTC
 * day. The receipt is written to localStorage before the POST so two
 * mounts in the same page (or a reload) cannot double-count the day;
 * with storage unavailable the session is recorded every time, which
 * is the safe direction.
 */
export function recordSessionOnce(workspaceId: number): void {
	const key = sessionKey(workspaceId, utcDayKey(new Date()));
	try {
		if (typeof localStorage !== 'undefined') {
			if (localStorage.getItem(key) !== null) return;
			localStorage.setItem(key, '1');
		}
	} catch {
		// Storage unavailable (private mode): record without a receipt.
	}
	void record('session', workspaceId);
}

/**
 * sinceDaysAgo returns the RFC 3339 instant `days` days before now —
 * the lower bound sent to GET /api/events for a fixed-size window.
 */
export function sinceDaysAgo(days: number): string {
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
	return since.toISOString();
}
