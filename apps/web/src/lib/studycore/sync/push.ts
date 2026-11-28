// Typed study writes on the wire (docs/contracts/study/, lww.json): a planned
// StudyWrite (plan.ts) becomes a push item of its collection, stamped after
// the time the server holds for the row (stampOf) — last write wins on it. A
// tombstone carries the stored row's last data and `deletedAt`.

import { pushChunks, sendPush, skippedOf, stampOf, type ChunkOptions } from '$lib/sync/push';
import type { StudyWrite } from '../plan';

/** typedBody: the push body of `writes`, each stamped at `nowMs` or just after what the server holds. */
export function typedBody(workspaceId: number, writes: readonly StudyWrite[], nowMs: number, stamps?: string[]): Record<string, unknown[]> {
	const body: Record<string, unknown[]> = {};
	for (const write of writes) {
		const stamp = stampOf(nowMs, write.knownAt);
		stamps?.push(stamp);
		(body[write.collection] ??= []).push({
			...write.row,
			workspaceId,
			updatedAt: stamp,
			// A tombstone: the server skips it when it holds no live row.
			...(write.deleted ? { deletedAt: stamp } : {})
		});
	}
	return body;
}

/**
 * pushTyped writes typed rows through POST /api/sync/push in sequential chunks.
 * Answers the stamp each write was sent with. A chunk the server only partly
 * applied is a PartialPushError (pushChunks).
 */
export async function pushTyped(
	workspaceId: number,
	writes: readonly StudyWrite[],
	opts: ChunkOptions = {},
	/** Filled with each write's stamp as its chunk is built (readable in `opts.after`). */
	stamps: string[] = []
): Promise<string[]> {
	await pushChunks(writes.length, opts, (from, to, nowMs) => typedBody(workspaceId, writes.slice(from, to), nowMs, stamps));
	return stamps;
}

/**
 * pushTypedOne writes one row whose loss is fine (a tombstone another tab may
 * have written already): `ok` is false when the server skipped it.
 */
export async function pushTypedOne(workspaceId: number, write: StudyWrite, nowMs: number): Promise<{ ok: boolean; stamp: string }> {
	const stamps: string[] = [];
	const result = await sendPush(typedBody(workspaceId, [write], nowMs, stamps));
	return { ok: skippedOf(result) === 0, stamp: stamps[0] };
}
