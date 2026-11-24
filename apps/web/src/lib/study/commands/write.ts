// The write primitives every study command uses (#193): typed rows through the
// push (study/sync/push.ts), keyed rows of the study namespace through
// lib/sync/keyed.ts. A write that landed is held in the study cache at once,
// with the stamp it was sent with (or the server's answer); a write that failed
// or that the server skipped (it holds newer rows) marks the workspace stale,
// so the next plan reads a delta first. Either way the cache's listeners hear
// which workspace changed (data.ts onStudyChange).

import { PartialPushError } from '../../sync/push';
import { STUDY_NAMESPACE, keyedData, pushKeyed, type KeyedRow, type KeyedWrite } from '../../sync/keyed';
import { sessionEpoch } from '../../session/sessionEnd';
import { stampOf } from '../../sync/push';
import { ALL_WORKSPACES, assertReadableKeyed, planningView, studyCache } from '../data';
import type { StudyView } from '../readModel';
import type { StudyWrite } from '../plan';
import type { StudyRow } from '../rows';
import { pushTyped, pushTypedOne } from '../sync/push';

export { requireWorkspaceArg } from '../data';

/** The row the server holds after `write` landed with `stamp`. */
function heldRow(workspaceId: number, write: StudyWrite, stamp: string): StudyRow {
	return {
		...write.row,
		workspaceId,
		version: 0,
		updatedAt: stamp,
		deletedAt: write.deleted ? stamp : null
	} as StudyRow;
}

/** The cache as the session that started a write sees it: once that session ended, its answer changes nothing (#173). */
type Bound = Pick<typeof studyCache, 'applyTyped' | 'applyKeyed' | 'markStale'>;

function bound(): Bound {
	const epoch = sessionEpoch();
	const live = (): boolean => epoch === sessionEpoch();
	return {
		applyTyped: (...args) => (live() ? studyCache.applyTyped(...args) : undefined),
		applyKeyed: (...args) => (live() ? studyCache.applyKeyed(...args) : undefined),
		markStale: (...args) => (live() ? studyCache.markStale(...args) : undefined)
	};
}

function hold(cache: Bound, workspaceId: number, writes: readonly StudyWrite[], stamps: readonly string[]): void {
	const byCollection = new Map<StudyWrite['collection'], StudyRow[]>();
	writes.forEach((write, i) => {
		const list = byCollection.get(write.collection) ?? [];
		list.push(heldRow(workspaceId, write, stamps[i]));
		byCollection.set(write.collection, list);
	});
	if (byCollection.size === 0) return;
	for (const [collection, rows] of byCollection) cache.applyTyped(workspaceId, collection, rows);
}

/**
 * pushStudy writes typed study rows through POST /api/sync/push in sequential
 * chunks (last write wins on `updatedAt`, see stampOf). A chunk the server only
 * partly applied (a newer row won, or it refused one) is a PartialPushError:
 * callers must never report success for it.
 */
export async function pushStudy(
	workspaceId: number,
	writes: readonly StudyWrite[],
	opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<void> {
	const cache = bound();
	const stamps: string[] = [];
	await pushTyped(
		workspaceId,
		writes,
		{
			...opts,
			after: (from, to, ok) => {
				if (ok) hold(cache, workspaceId, writes.slice(from, to), stamps.slice(from, to));
				else cache.markStale(workspaceId);
			}
		},
		stamps
	);
}

/**
 * replanned runs a planned write against the cache, and once more against a
 * refreshed view when the server skipped part of it (it holds newer rows: the
 * refresh learns their stamps, so the new plan is stamped after them, or finds
 * the work done). A second skip is the PartialPushError it was.
 */
export async function replanned<T>(workspaceId: number, run: (view: StudyView) => Promise<T>): Promise<T> {
	try {
		return await run(await planningView(workspaceId));
	} catch (err) {
		if (!(err instanceof PartialPushError) || err.skipped === 0) throw err;
		return run(await planningView(workspaceId));
	}
}

/**
 * pushOptional writes one typed row whose loss is fine (a tombstone another
 * tab may have written already): false when the server skipped it.
 */
export async function pushOptional(workspaceId: number, write: StudyWrite): Promise<boolean> {
	const cache = bound();
	let result: { ok: boolean; stamp: string };
	try {
		result = await pushTypedOne(workspaceId, write, Date.now());
	} catch (err) {
		cache.markStale(workspaceId);
		throw err;
	}
	if (result.ok) hold(cache, workspaceId, [write], [result.stamp]);
	else cache.markStale(workspaceId);
	return result.ok;
}

function keyedHeld(workspaceId: number | null, key: string, data: unknown, stamp: string, deleted: boolean): KeyedRow {
	return {
		pluginId: STUDY_NAMESPACE,
		key,
		workspaceId,
		data,
		version: 0,
		updatedAt: stamp,
		deletedAt: deleted ? stamp : null
	};
}

/** putData stores one keyed row of the study namespace (PUT: the server stamps it and answers the row). */
export async function putData(workspaceId: number | null, key: string, value: unknown): Promise<void> {
	const cache = bound();
	assertReadableKeyed(workspaceId ?? ALL_WORKSPACES, key);
	let row: KeyedRow | null;
	try {
		row = await keyedData(STUDY_NAMESPACE, workspaceId).put(key, value);
	} catch (err) {
		cache.markStale(workspaceId);
		throw err;
	}
	if (row === null) cache.markStale(workspaceId);
	else cache.applyKeyed(workspaceId, [row]);
}

/** deleteData tombstones one keyed row of the study namespace; a missing row counts as deleted. */
export async function deleteData(workspaceId: number | null, key: string): Promise<void> {
	const cache = bound();
	assertReadableKeyed(workspaceId ?? ALL_WORKSPACES, key);
	try {
		await keyedData(STUDY_NAMESPACE, workspaceId).delete(key);
	} catch (err) {
		cache.markStale(workspaceId);
		throw err;
	}
	// The server does not answer its stamp. The tombstone is held just after the stamp this tab
	// knew, so any row the server sends later wins over it (this device's clock may run ahead);
	// a row the cache does not hold only marks the workspace stale.
	const known = studyCache.keyedStamp(workspaceId, key);
	if (known === undefined) cache.markStale(workspaceId);
	else cache.applyKeyed(workspaceId, [keyedHeld(workspaceId, key, null, stampOf(0, known), true)]);
}

/** pushKeyedRows writes keyed rows of the study namespace through the push, like pushStudy. */
export async function pushKeyedRows(
	workspaceId: number,
	rows: readonly KeyedWrite[],
	opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<void> {
	const cache = bound();
	for (const row of rows) assertReadableKeyed(workspaceId, row.key);
	const stamps: string[] = [];
	const after = (from: number, to: number, ok: boolean): void => {
		if (!ok) {
			cache.markStale(workspaceId);
			return;
		}
		const held = rows.slice(from, to).map((row, i) => keyedHeld(workspaceId, row.key, row.data, stamps[from + i], row.deleted === true));
		cache.applyKeyed(workspaceId, held);
	};
	await pushKeyed(STUDY_NAMESPACE, workspaceId, rows, { ...opts, after }, stamps);
}
