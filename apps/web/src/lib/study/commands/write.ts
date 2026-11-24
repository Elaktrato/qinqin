// The write primitives every study command uses (#193): typed rows through the
// push (study/sync/push.ts), keyed rows of the study namespace through
// lib/sync/keyed.ts. Each tells the listeners (data.ts) which workspace it
// touched, also when the request failed (a failed write may still have landed).

import { STUDY_NAMESPACE, keyedData, pushKeyed, type KeyedWrite } from '../../sync/keyed';
import { assertReadableKeyed, notifyWrite } from '../data';
import type { StudyWrite } from '../plan';
import { pushTyped, pushTypedOne } from '../sync/push';

export { requireWorkspaceArg } from '../data';

/**
 * pushStudy writes typed study rows through POST /api/sync/push in sequential
 * chunks (last write wins on `updatedAt`, see stampOf). A chunk the server only
 * partly applied (a newer row won, or it refused one) is a PartialPushError:
 * callers must never report success for it. Listeners are notified after each
 * chunk.
 */
export async function pushStudy(
	workspaceId: number,
	writes: readonly StudyWrite[],
	opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<void> {
	await pushTyped(workspaceId, writes, { ...opts, after: () => notifyWrite(workspaceId) });
}

/**
 * pushOptional writes one typed row whose loss is fine (a tombstone another
 * tab may have written already): false when the server skipped it.
 */
export async function pushOptional(workspaceId: number, write: StudyWrite): Promise<boolean> {
	try {
		return (await pushTypedOne(workspaceId, write, Date.now())).ok;
	} finally {
		notifyWrite(workspaceId);
	}
}

/** putData stores one keyed row of the study namespace (PUT: the server stamps it). */
export async function putData(workspaceId: number | null, key: string, value: unknown): Promise<void> {
	assertReadableKeyed(workspaceId ?? 0, key);
	try {
		await keyedData(STUDY_NAMESPACE, workspaceId).put(key, value);
	} finally {
		notifyWrite(workspaceId ?? 0);
	}
}

/** deleteData tombstones one keyed row of the study namespace; a missing row counts as deleted. */
export async function deleteData(workspaceId: number | null, key: string): Promise<void> {
	assertReadableKeyed(workspaceId ?? 0, key);
	try {
		await keyedData(STUDY_NAMESPACE, workspaceId).delete(key);
	} finally {
		notifyWrite(workspaceId ?? 0);
	}
}

/** pushKeyedRows writes keyed rows of the study namespace through the push, like pushStudy. */
export async function pushKeyedRows(
	workspaceId: number,
	rows: readonly KeyedWrite[],
	opts: { chunk?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<void> {
	for (const row of rows) assertReadableKeyed(workspaceId, row.key);
	await pushKeyed(STUDY_NAMESPACE, workspaceId, rows, { ...opts, after: () => notifyWrite(workspaceId) });
}
