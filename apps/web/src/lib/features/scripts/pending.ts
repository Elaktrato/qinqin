// Answers not yet stored by the server (offline practice). The review outbox is for reviews; a script answer
// waits in this small per-workspace list in the browser's storage, is sent on the next load and counted in the
// progress meanwhile. The event id is made once, so a retry is a duplicate the server ignores.

import type { StudyEventBody } from '$lib/api/types';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (workspaceId: number): string => `qinqin.scripts.pending.${workspaceId}`;
const droppedKey = (workspaceId: number): string => `qinqin.scripts.pendingDropped.${workspaceId}`;
export const MAX_PENDING = 2000;

function isEvent(value: unknown, workspaceId: number): value is StudyEventBody {
	if (typeof value !== 'object' || value === null) return false;
	const e = value as Record<string, unknown>;
	return e.type === 'script' && typeof e.id === 'string' && typeof e.ts === 'string' && e.workspaceId === workspaceId && typeof e.payload === 'object' && e.payload !== null;
}

/** readPending: the waiting answers of a workspace; unreadable storage or junk is an empty list. */
export function readPending(store: Store | null, workspaceId: number): StudyEventBody[] {
	if (store === null) return [];
	try {
		const raw = store.getItem(key(workspaceId));
		const parsed: unknown = raw === null ? [] : JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((e): e is StudyEventBody => isEvent(e, workspaceId)) : [];
	} catch {
		return [];
	}
}

/**
 * writePending stores the list. Past MAX_PENDING the oldest are dropped, never silently: the number is added to a
 * counter the page shows (readDropped). Returns how many were dropped now. Storage that refuses is ignored.
 */
export function writePending(store: Store | null, workspaceId: number, list: readonly StudyEventBody[]): number {
	if (store === null) return 0;
	try {
		if (list.length === 0) {
			store.removeItem(key(workspaceId));
			return 0;
		}
		const dropped = Math.max(0, list.length - MAX_PENDING);
		store.setItem(key(workspaceId), JSON.stringify(list.slice(-MAX_PENDING)));
		if (dropped > 0) store.setItem(droppedKey(workspaceId), String(readDropped(store, workspaceId) + dropped));
		return dropped;
	} catch {
		// Private mode or full storage: the answer is still sent now; only the retry is lost.
		return 0;
	}
}

/** readDropped: how many waiting answers were discarded for lack of room and not yet acknowledged. */
export function readDropped(store: Store | null, workspaceId: number): number {
	if (store === null) return 0;
	try {
		const n = Number(store.getItem(droppedKey(workspaceId)));
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
	} catch {
		return 0;
	}
}

export function clearDropped(store: Store | null, workspaceId: number): void {
	try {
		store?.removeItem(droppedKey(workspaceId));
	} catch {
		// Nothing to clear.
	}
}

const flushing = new Set<number>();

/**
 * flushPending sends what waited from an earlier, offline round (the ids make a retry harmless) and removes what
 * the server took. One flush per workspace at a time; true when nothing is left waiting.
 */
export async function flushPending(store: Store | null, workspaceId: number, post: (events: StudyEventBody[]) => Promise<unknown>): Promise<boolean> {
	if (flushing.has(workspaceId)) return false;
	const waiting = readPending(store, workspaceId);
	if (waiting.length === 0) return true;
	flushing.add(workspaceId);
	try {
		await post(waiting);
		writePending(store, workspaceId, withoutSent(readPending(store, workspaceId), new Set(waiting.map((e) => e.id))));
		return readPending(store, workspaceId).length === 0;
	} catch {
		return false; // Still offline: they stay.
	} finally {
		flushing.delete(workspaceId);
	}
}

/** withoutSent drops the events with these ids from a list. */
export function withoutSent(list: readonly StudyEventBody[], sentIds: ReadonlySet<string>): StudyEventBody[] {
	return list.filter((e) => !sentIds.has(e.id));
}

/** mergeLog: the stored log plus the waiting answers the log does not hold yet. */
export function mergeLog(log: readonly LogEvent[], pending: readonly LogEvent[]): LogEvent[] {
	const have = new Set(log.map((e) => e.id));
	return [...log, ...pending.filter((e) => !have.has(e.id))];
}

interface LogEvent {
	id?: string;
	ts: string;
	type: string;
	payload: unknown;
}
