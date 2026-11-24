// POST /api/sync/push (docs/contracts/sync/, push-result.json) for rows that
// carry their own last-write-wins stamp: typed study rows (study/sync/push.ts)
// and keyed rows (keyed.ts). A batch goes in sequential chunks; a
// chunk the server only partly applied (it holds a newer row, or refused one)
// is a PartialPushError, so a caller never reports success for it.

import { errorText } from '../api/apiErrors';
import { ShownError } from '../api/userError';
import { api } from '../api/client';
import { t } from '../i18n';

export interface PushResult {
	dataAccepted?: number;
	dataSkipped?: number;
	dataRefused?: number;
}

/**
 * PartialPushError: a batch write stopped. `done` rows were written; `skipped`
 * is how many the server did not apply because it holds a newer row for the key
 * (e.g. a later tombstone) or refused them. Re-planning and trying again writes
 * only what is still missing.
 */
export class PartialPushError extends ShownError {
	done: number;
	skipped: number;

	constructor(message: string, done: number, skipped = 0) {
		super(message);
		this.name = 'PartialPushError';
		this.done = done;
		this.skipped = skipped;
	}
}

/** The earliest stamp that beats a row last written at `knownAt`: one millisecond later. */
function stampAfter(knownAt: string | undefined): number {
	const ms = knownAt === undefined ? NaN : Date.parse(knownAt);
	return Number.isNaN(ms) ? 0 : ms + 1;
}

/**
 * stampOf: the stamp of a write made at `nowMs` to a row the server last wrote
 * at `knownAt`. Last write wins on it, so it is never earlier than what the
 * server already holds (a client clock behind the server's would lose to a
 * fresh tombstone for ever).
 */
export function stampOf(nowMs: number, knownAt: string | undefined): string {
	return new Date(Math.max(nowMs, stampAfter(knownAt))).toISOString();
}

/** sendPush posts one push body. */
export function sendPush(body: Record<string, unknown>): Promise<PushResult> {
	return api<PushResult>('/api/sync/push', { method: 'POST', body });
}

/** skippedOf: the rows of a push answer that were not applied. */
export function skippedOf(result: PushResult | undefined): number {
	return (result?.dataSkipped ?? 0) + (result?.dataRefused ?? 0);
}

export interface ChunkOptions {
	/** Rows per request (200). */
	chunk?: number;
	onProgress?: (done: number, total: number) => void;
	/** The clock of the stamps (Date.now). */
	now?: () => number;
	/**
	 * Called after each chunk's request, landed or not: `ok` is true when every
	 * row of it was applied. A failed request may still have landed.
	 */
	after?: (from: number, to: number, ok: boolean, nowMs: number) => void;
}

/**
 * pushChunks sends rows [0, total) in chunks of `chunk`; `bodyOf` builds the
 * body of rows [from, to) stamped at `nowMs`.
 */
export async function pushChunks(
	total: number,
	opts: ChunkOptions,
	bodyOf: (from: number, to: number, nowMs: number) => Record<string, unknown>
): Promise<void> {
	const size = Math.max(1, opts.chunk ?? 200);
	const now = opts.now ?? Date.now;
	let done = 0;
	for (let i = 0; i < total; i += size) {
		const count = Math.min(size, total - i);
		const nowMs = now();
		let result: PushResult;
		try {
			result = await sendPush(bodyOf(i, i + count, nowMs));
		} catch (err) {
			opts.after?.(i, i + count, false, nowMs);
			throw new PartialPushError(errorText(err, t('study.store.writeFailed')), done);
		}
		const skipped = skippedOf(result);
		opts.after?.(i, i + count, skipped === 0, nowMs);
		done += result?.dataAccepted ?? count - skipped;
		if (skipped > 0) {
			throw new PartialPushError(t('study.store.partialPush', { count: skipped }), done, skipped);
		}
		opts.onProgress?.(done, total);
	}
}
