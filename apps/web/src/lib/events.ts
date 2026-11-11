// Study-event recording: every event is an append-only row the server
// keys on a client-generated ULID. Recording is fire-and-forget — a
// failed POST must never break the page the user is on.

import { api } from './api/client';
import type { StudyEventBody } from './api/types';
import { newUlid } from './ulid';

export type EventType = 'session' | 'view' | 'lookup' | 'review';

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
	await api('/api/events/batch', {
		method: 'POST',
		body: { events }
	});
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
