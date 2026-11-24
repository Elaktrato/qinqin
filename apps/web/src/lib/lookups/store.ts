// Thin I/O for the lookup history (#72): the qinqin-core `lookups` row of a
// workspace and the user-global `lookupcfg` switch, through the plugin SDK,
// plus the one lookup-specific route DELETE /api/events/lookups. Rules live
// in lookups.ts, buffering in recorder.ts. Every write here reads the row
// first in the same call (docs/contracts/lookups/README.md).

import { api, getToken } from '../api/client';
import { t } from '../i18n';
import { keyedData, type KeyedScope } from '../sync/keyed';
import { ownPartition } from '../pwa/partitions';
import { clearReceipts } from '../pwa/prepareOffline';
import { holdsLookups } from '../pwa/sw/classify';
import { scrubForCache, scrubbedPath } from '../pwa/sw/scrub';
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
import type { LookupsState } from './state';

/** The history row was cleared but the old `lookup` events could not be deleted. */
export class LookupEventsNotDeletedError extends Error {
	constructor() {
		super(t('lookups.eventsNotDeleted'));
		this.name = 'LookupEventsNotDeletedError';
	}
}

const rows = (ws: number): KeyedScope => keyedData(ws);
const global = (): KeyedScope => keyedData(null);

export async function loadHistory(ws: number): Promise<LookupHistory> {
	return parseLookups(await rows(ws).find(LOOKUPS_KEY));
}

async function write(ws: number, h: LookupHistory): Promise<void> {
	await rows(ws).put(LOOKUPS_KEY, serializeLookups(h));
}

/** removeFromHistory reads the row and writes it back without the entries. */
export async function removeFromHistory(lookups: LookupsState, ws: number, entryIds: number[]): Promise<LookupHistory> {
	const recorder = lookups.recorder;
	const next = await recorder.exclusive(async () => {
		const h = removeLookups(await loadHistory(ws), entryIds);
		await write(ws, h);
		recorder.adopt(ws, h);
		return h;
	});
	await scrubOfflineLookups();
	return next;
}

/** How long after a Clear the row is checked once for a stale write-back. */
export const REPAIR_AFTER_CLEAR_MS = 30_000;


/** The server time of a write (`updatedAt` of the PUT answer), if it is RFC 3339. */
function serverTime(res: unknown): string | null {
	const at = (res as { updatedAt?: unknown } | null | undefined)?.updatedAt;
	return typeof at === 'string' && instant(at) !== null ? at : null;
}

async function writeCleared(ws: number, h: LookupHistory): Promise<string | null> {
	return serverTime(await rows(ws).put(LOOKUPS_KEY, serializeLookups(h)));
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
	lookups: LookupsState,
	ws: number,
	now: Date = new Date(),
	opts: { onRepaired?: (ws: number) => void; invalidateEvents?: (ws: number) => void } = {}
): Promise<{ eventsDeleted: number; history: LookupHistory }> {
	const { recorder, repairs } = lookups;
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
	// The session ended during the clear: no check is scheduled and nothing is
	// deleted with the next user's token.
	if (!lookups.alive) return { eventsDeleted: 0, history: next };
	clearTimeout(repairs.get(ws));
	repairs.set(
		ws,
		setTimeout(() => {
			repairs.delete(ws);
			void repairAfterClear(lookups, ws, mine)
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
		opts.invalidateEvents?.(ws);
		await scrubOfflineLookups();
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
export async function repairAfterClear(lookups: LookupsState, ws: number, cleared: string): Promise<boolean> {
	const recorder = lookups.recorder;
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
export async function saveLookupCfg(lookups: LookupsState, record: boolean): Promise<void> {
	const previous = await loadLookupCfg();
	await global().put(LOOKUP_CFG_KEY, serializeLookupCfg(record, previous));
	lookups.recorder.setRecording(record);
}

interface CacheLike {
	keys(): Promise<readonly Request[]>;
	match(request: Request | string): Promise<Response | undefined>;
	put(request: Request | string, response: Response): Promise<void>;
	delete(request: Request | string): Promise<boolean>;
}

interface CachesLike {
	keys(): Promise<string[]>;
	open(name: string): Promise<CacheLike>;
}

/**
 * scrubOfflineLookups cleans the saved offline copies of the current
 * credential's service worker partition after a Clear or Remove: saved pulls
 * and event logs are filtered in place (the lookups rows and old lookup
 * events taken out, everything else and the save time kept), so offline
 * study stays ready. The worker already filters what it saves (scrub.ts);
 * this covers copies saved before. A copy that cannot be read, or a saved
 * read of the lookup rows, is deleted, and then the "prepared" receipts are
 * cleared so the app prepares offline use again. Best effort.
 */
export async function scrubOfflineLookups(
	cachesLike: CachesLike | undefined = typeof caches === 'undefined' ? undefined : (caches as unknown as CachesLike)
): Promise<void> {
	if (cachesLike === undefined) return;
	try {
		const token = getToken();
		if (!token) return;
		const name = await ownPartition(token);
		if (!(await cachesLike.keys()).includes(name)) return;
		const cache = await cachesLike.open(name);
		let deleted = false;
		for (const req of await cache.keys()) {
			const url = new URL(req.url);
			if (holdsLookups(url)) {
				deleted = (await cache.delete(req)) || deleted;
				continue;
			}
			if (!scrubbedPath(url.pathname)) continue;
			const saved = await cache.match(req);
			if (!saved) continue;
			const text = await saved.clone().text();
			const body = scrubForCache(url.pathname, text);
			if (body === null) {
				deleted = (await cache.delete(req)) || deleted;
			} else if (body !== text) {
				const headers = new Headers(saved.headers);
				headers.delete('content-length');
				await cache.put(req, new Response(body, { status: saved.status, statusText: saved.statusText, headers }));
			}
		}
		if (deleted) clearReceipts(typeof localStorage === 'undefined' ? null : localStorage);
	} catch {
		// Best effort: Cache Storage may be unavailable.
	}
}
