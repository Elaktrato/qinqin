// The write primitives every study command uses (#193): typed rows through the
// push (study/sync/push.ts), keyed rows of the study namespace through
// lib/sync/keyed.ts. A write that landed is held in the study cache at once,
// with the stamp it was sent with (or the server's answer); a write that failed
// or that the server skipped (it holds newer rows) marks the workspace stale,
// so the next plan reads a delta first. Either way the cache's listeners hear
// which workspace changed (data.ts onStudyChange).

import { PartialPushError } from '../../sync/push';
import { STUDY_NAMESPACE, keyedData, pushKeyed, type KeyedRow, type KeyedWrite } from '../../sync/keyed';
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

function hold(workspaceId: number, writes: readonly StudyWrite[], stamps: readonly string[]): void {
	const byCollection = new Map<StudyWrite['collection'], StudyRow[]>();
	writes.forEach((write, i) => {
		const list = byCollection.get(write.collection) ?? [];
		list.push(heldRow(workspaceId, write, stamps[i]));
		byCollection.set(write.collection, list);
	});
	if (byCollection.size === 0) return;
	for (const [collection, rows] of byCollection) studyCache.applyTyped(workspaceId, collection, rows);
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
	const stamps: string[] = [];
	await pushTyped(
		workspaceId,
		writes,
		{
			...opts,
			after: (from, to, ok) => {
				if (ok) hold(workspaceId, writes.slice(from, to), stamps.slice(from, to));
				else studyCache.markStale(workspaceId);
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
	let result: { ok: boolean; stamp: string };
	try {
		result = await pushTypedOne(workspaceId, write, Date.now());
	} catch (err) {
		studyCache.markStale(workspaceId);
		throw err;
	}
	if (result.ok) hold(workspaceId, [write], [result.stamp]);
	else studyCache.markStale(workspaceId);
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
	assertReadableKeyed(workspaceId ?? ALL_WORKSPACES, key);
	let row: KeyedRow | null;
	try {
		row = await keyedData(STUDY_NAMESPACE, workspaceId).put(key, value);
	} catch (err) {
		studyCache.markStale(workspaceId);
		throw err;
	}
	if (row === null) studyCache.markStale(workspaceId);
	else studyCache.applyKeyed(workspaceId, [row]);
}

/** deleteData tombstones one keyed row of the study namespace; a missing row counts as deleted. */
export async function deleteData(workspaceId: number | null, key: string): Promise<void> {
	assertReadableKeyed(workspaceId ?? ALL_WORKSPACES, key);
	try {
		await keyedData(STUDY_NAMESPACE, workspaceId).delete(key);
	} catch (err) {
		studyCache.markStale(workspaceId);
		throw err;
	}
	// The server's stamp is not answered: the local time stands in (a skip re-reads).
	studyCache.applyKeyed(workspaceId, [keyedHeld(workspaceId, key, null, new Date().toISOString(), true)]);
}

/** pushKeyedRows writes keyed rows of the study namespace through the push, like pushStudy. */
export async function pushKeyedRows(
	workspaceId: number,
	rows: readonly KeyedWrite[],
	opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<void> {
	for (const row of rows) assertReadableKeyed(workspaceId, row.key);
	const stamps: string[] = [];
	const after = (from: number, to: number, ok: boolean): void => {
		if (!ok) {
			studyCache.markStale(workspaceId);
			return;
		}
		const held = rows.slice(from, to).map((row, i) => keyedHeld(workspaceId, row.key, row.data, stamps[from + i], row.deleted === true));
		studyCache.applyKeyed(workspaceId, held);
	};
	await pushKeyed(STUDY_NAMESPACE, workspaceId, rows, { ...opts, after }, stamps);
}
