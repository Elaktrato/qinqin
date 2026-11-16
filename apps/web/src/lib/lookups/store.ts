// Thin I/O for the lookup history (#72): the qinqin-core `lookups` row of a
// workspace and the user-global `lookupcfg` switch, through the plugin SDK,
// plus the one lookup-specific route DELETE /api/events/lookups. Rules live
// in lookups.ts, buffering in recorder.ts. Every write here reads the row
// first in the same call (docs/contracts/lookups/README.md).

import { api, getToken } from '../api/client';
import { invalidateWorkspaceEvents } from '../events';
import { coreManifest } from '../plugins/core/manifest';
import { createPluginSdk, type DataScope } from '../plugins/sdk';
import { ownPartition } from '../pwa/partitions';
import {
	LOOKUPS_KEY,
	LOOKUP_CFG_KEY,
	type LookupCfg,
	type LookupHistory,
	clearedLookups,
	instant,
	parseLookupCfg,
	parseLookups,
	removeLookups,
	serializeLookupCfg,
	serializeLookups,
	staleAfterClear
} from './lookups';
import { LookupRecorder, type RecorderIO } from './recorder';

/** The history row was cleared but the old `lookup` events could not be deleted. */
export class LookupEventsNotDeletedError extends Error {
	constructor() {
		super('The history is cleared, but the old search records could not be deleted. Try Clear history again.');
		this.name = 'LookupEventsNotDeletedError';
	}
}

const sdk = () => createPluginSdk(coreManifest);
const rows = (ws: number): DataScope => sdk().data.workspace(ws);
const global = (): DataScope => sdk().data.user();

export const recorderIO: RecorderIO = {
	readRow: (ws) => rows(ws).find(LOOKUPS_KEY),
	writeRow: (ws, data) => rows(ws).put(LOOKUPS_KEY, data),
	readCfg: () => global().find(LOOKUP_CFG_KEY)
};

let recorder: LookupRecorder | null = null;

/** lookupRecorder is the tab's one recorder (memory only), flushed when the page is hidden. */
export function lookupRecorder(): LookupRecorder {
	if (recorder === null) {
		recorder = new LookupRecorder(recorderIO);
		if (typeof document !== 'undefined') recorder.attach(document);
	}
	return recorder;
}

/** resetLookupRecorder drops the tab's buffer and copies (sign-out). */
export function resetLookupRecorder(): void {
	cancelRepairs();
	recorder?.reset();
}

export async function loadHistory(ws: number): Promise<LookupHistory> {
	return parseLookups(await rows(ws).find(LOOKUPS_KEY));
}

async function write(ws: number, h: LookupHistory): Promise<void> {
	await rows(ws).put(LOOKUPS_KEY, serializeLookups(h));
}

/** removeFromHistory reads the row and writes it back without the entries. */
export async function removeFromHistory(ws: number, entryIds: number[]): Promise<LookupHistory> {
	const recorder = lookupRecorder();
	const next = await recorder.exclusive(async () => {
		const h = removeLookups(await loadHistory(ws), entryIds);
		await write(ws, h);
		recorder.adopt(ws, h);
		return h;
	});
	await forgetOfflineLookups();
	return next;
}

/** How long after a Clear the row is checked once for a stale write-back. */
export const REPAIR_AFTER_CLEAR_MS = 30_000;

const repairs = new Map<number, ReturnType<typeof setTimeout>>();

function cancelRepairs(): void {
	for (const t of repairs.values()) clearTimeout(t);
	repairs.clear();
}

/** The server time of a write (`updatedAt` of the PUT answer), if it is RFC 3339. */
function serverTime(res: unknown): string | null {
	const at = (res as { updatedAt?: unknown } | null | undefined)?.updatedAt;
	return typeof at === 'string' && instant(at) !== null ? at : null;
}

async function writeCleared(ws: number, h: LookupHistory): Promise<string | null> {
	return serverTime(await api<unknown>(`/api/plugins/qinqin-core/data/${LOOKUPS_KEY}?workspace=${ws}`, { method: 'PUT', body: serializeLookups(h) }));
}

/**
 * clearHistory overwrites the row with an empty one (a PUT, so no tombstone
 * keeps the words), then deletes the workspace's old `lookup` events and
 * scrubs the offline copies. clearedAt is the server's time of that write
 * (the row is written again with it when it differs from this device's
 * clock), so other devices' lookups compare against one clock. 30 s later
 * the row is checked once (repairAfterClear) from here, not from the page,
 * so leaving the page does not cancel it; `onRepaired` hears when it had to
 * clear again.
 */
export async function clearHistory(
	ws: number,
	now: Date = new Date(),
	opts: { onRepaired?: (ws: number) => void } = {}
): Promise<{ eventsDeleted: number; history: LookupHistory }> {
	const recorder = lookupRecorder();
	// In the recorder's chain: a flush of this tab that read the row before
	// the Clear finishes first, and none starts until the row is cleared.
	const next = await recorder.exclusive(async () => {
		let h = clearedLookups(await loadHistory(ws), now);
		const at = await writeCleared(ws, h);
		if (at !== null && at !== h.clearedAt) {
			h = { ...h, clearedAt: at };
			await writeCleared(ws, h);
		}
		recorder.adopt(ws, h);
		return h;
	});
	const mine = next.clearedAt as string;
	clearTimeout(repairs.get(ws));
	repairs.set(
		ws,
		setTimeout(() => {
			repairs.delete(ws);
			void repairAfterClear(ws, mine)
				.then((again) => {
					if (again) opts.onRepaired?.(ws);
				})
				.catch(() => undefined);
		}, REPAIR_AFTER_CLEAR_MS)
	);
	let deleted: number;
	try {
		const res = await api<{ deleted?: unknown } | undefined>(`/api/events/lookups?workspace=${ws}`, { method: 'DELETE' });
		deleted = typeof res?.deleted === 'number' ? res.deleted : 0;
	} catch {
		throw new LookupEventsNotDeletedError();
	} finally {
		invalidateWorkspaceEvents(ws);
		await forgetOfflineLookups();
	}
	return { eventsDeleted: deleted, history: next };
}

/**
 * repairAfterClear: another device's flush that read the row before the
 * Clear at `cleared` may have written its old copy back. When the row is no
 * longer that clear (staleAfterClear), it is cleared again with the same
 * clearedAt and no items (a stale copy's counts include the erased past, so
 * nothing of it is kept). True when it cleared again.
 */
export async function repairAfterClear(ws: number, cleared: string): Promise<boolean> {
	const recorder = lookupRecorder();
	return recorder.exclusive(async () => {
		const h = await loadHistory(ws);
		if (!staleAfterClear(h, cleared)) return false;
		const next: LookupHistory = { clearedAt: cleared, items: [], extra: h.extra };
		await write(ws, next);
		recorder.adopt(ws, next);
		return true;
	});
}

export async function loadLookupCfg(): Promise<LookupCfg> {
	return parseLookupCfg(await global().find(LOOKUP_CFG_KEY));
}

/** saveLookupCfg re-reads the switch to keep its unknown members, then writes it. */
export async function saveLookupCfg(record: boolean): Promise<void> {
	const previous = await loadLookupCfg();
	await global().put(LOOKUP_CFG_KEY, serializeLookupCfg(record, previous));
	lookupRecorder().setRecording(record);
}

interface CachesLike {
	keys(): Promise<string[]>;
	open(name: string): Promise<{ keys(): Promise<readonly Request[]>; delete(request: Request | string): Promise<boolean> }>;
}

/**
 * forgetOfflineLookups deletes the saved offline copies (service worker API
 * partition of the current credential) that can hold the history or old
 * lookup events: whole-account pulls, event logs and qinqin-core plugin
 * data. They are fetched again the next time a page needs them. Best effort.
 */
export async function forgetOfflineLookups(
	cachesLike: CachesLike | undefined = typeof caches === 'undefined' ? undefined : (caches as unknown as CachesLike)
): Promise<void> {
	if (cachesLike === undefined) return;
	try {
		const token = getToken();
		if (!token) return;
		const name = await ownPartition(token);
		if (!(await cachesLike.keys()).includes(name)) return;
		const cache = await cachesLike.open(name);
		for (const req of await cache.keys()) {
			const path = new URL(req.url).pathname;
			if (path === '/api/sync/pull' || path === '/api/events' || path.startsWith('/api/plugins/qinqin-core/data')) {
				await cache.delete(req);
			}
		}
	} catch {
		// Best effort: Cache Storage may be unavailable.
	}
}
