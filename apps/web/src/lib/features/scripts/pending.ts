// Answers not yet stored by the server (offline practice). The review outbox is for reviews; a script answer
// waits in this small per-workspace list in the browser's storage, is sent on the next load and counted in the
// progress meanwhile. The event id is made once, so a retry is a duplicate the server ignores.

import type { StudyEventBody } from '$lib/api/types';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const key = (workspaceId: number): string => `qinqin.scripts.pending.${workspaceId}`;
const MAX_PENDING = 2000;

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

/** writePending stores the list (the oldest are dropped past a limit); storage that refuses is ignored. */
export function writePending(store: Store | null, workspaceId: number, list: readonly StudyEventBody[]): void {
	if (store === null) return;
	try {
		if (list.length === 0) store.removeItem(key(workspaceId));
		else store.setItem(key(workspaceId), JSON.stringify(list.slice(-MAX_PENDING)));
	} catch {
		// Private mode or full storage: the answer is still sent now; only the retry is lost.
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
