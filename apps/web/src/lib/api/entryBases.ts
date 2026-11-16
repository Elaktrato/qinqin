// Entry bases (written form, readings) of many entries, for the decks
// view: POST /api/entries/bases in chunks of 500, at most two requests in
// flight, cached for the session. The server applies the signed-in user's
// own overlay, so the cache is dropped on sign-out and per entry after an
// edit. Failures are never cached; successes of the same call stay.

import { api } from './client';
import type { EntryBase } from './types';

export const BASES_CHUNK = 500;
const CONCURRENCY = 2;

const cache = new Map<number, EntryBase>();
// Ids a request is (or is about to be) busy with, so concurrent callers share it.
const inflight = new Map<number, Promise<void>>();

/** clearEntryBasesCache forgets everything (sign-out, tests). */
export function clearEntryBasesCache(): void {
	cache.clear();
}

/** forgetEntryBases drops single ids, e.g. after the user edited those entries. */
export function forgetEntryBases(ids: readonly number[]): void {
	for (const id of ids) cache.delete(id);
}

function chunks<T>(list: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
	return out;
}

/**
 * loadEntryBases returns the bases of `ids` (unknown ids are absent from the
 * map). Missing ids are requested priority first, then in the given order.
 * A failed request rejects the call; what other requests already brought is
 * cached, so a retry asks only for the rest.
 */
export async function loadEntryBases(
	ids: readonly number[],
	opts: { priority?: readonly number[] } = {}
): Promise<Map<number, EntryBase>> {
	const wanted = [...new Set(ids)];
	const wantedSet = new Set(wanted);
	const first = (opts.priority ?? []).filter((id) => wantedSet.has(id));
	const ordered = [...new Set([...first, ...wanted])];
	const missing = ordered.filter((id) => !cache.has(id) && !inflight.has(id));
	const shared = new Set<Promise<void>>();
	for (const id of ordered) {
		const pending = inflight.get(id);
		if (pending !== undefined && !cache.has(id)) shared.add(pending);
	}

	type Job = { ids: number[]; resolve: () => void; reject: (e: unknown) => void };
	const jobs: Job[] = chunks(missing, BASES_CHUNK).map((part) => {
		let resolve!: () => void;
		let reject!: (e: unknown) => void;
		const promise = new Promise<void>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		promise.catch(() => undefined); // waiters handle it; never an unhandled rejection
		for (const id of part) inflight.set(id, promise);
		return { ids: part, resolve, reject };
	});

	let failure: unknown = null;
	let failed = false;
	let next = 0;
	const worker = async (): Promise<void> => {
		for (;;) {
			const job = jobs[next++];
			if (job === undefined) return;
			if (failed) {
				for (const id of job.ids) inflight.delete(id);
				job.reject(failure);
				continue;
			}
			try {
				const rows = await api<EntryBase[]>('/api/entries/bases', {
					method: 'POST',
					body: { ids: job.ids }
				});
				for (const row of Array.isArray(rows) ? rows : []) cache.set(row.id, row);
				for (const id of job.ids) inflight.delete(id);
				job.resolve();
			} catch (err) {
				failed = true;
				failure = err;
				for (const id of job.ids) inflight.delete(id);
				job.reject(err);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
	if (failed) throw failure;
	await Promise.all(shared);

	const out = new Map<number, EntryBase>();
	for (const id of wanted) {
		const row = cache.get(id);
		if (row !== undefined) out.set(id, row);
	}
	return out;
}
