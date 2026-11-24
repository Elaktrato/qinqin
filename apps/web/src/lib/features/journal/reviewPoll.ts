// After a proxy cut a long review (or ideas request), the server still
// writes the document. Poll the stored one until one newer than `since` shows up.
// `in_flight` is different: the request never ran (another call of the user
// held the AI slot), so it is sent again with the same id (sendRetryingInFlight).

import { ApiError } from '$lib/api/client';

export interface PollOptions {
	intervalMs?: number;
	timeoutMs?: number;
	sleep?: (ms: number) => Promise<void>;
	signal?: AbortSignal;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * pollUntil resolves the first load that `done` accepts, or null on timeout
 * or abort. A failed load counts as "not yet". Time is counted in sleeps, so
 * a test with an injected sleep needs no clock.
 */
export async function pollUntil<T>(load: () => Promise<T | null>, done: (value: T) => boolean, opts: PollOptions = {}): Promise<T | null> {
	const interval = opts.intervalMs ?? 5000;
	const timeout = opts.timeoutMs ?? 180000;
	const sleep = opts.sleep ?? realSleep;
	for (let waited = 0; waited <= timeout; waited += interval) {
		if (opts.signal?.aborted) return null;
		try {
			const value = await load();
			if (value !== null && done(value)) return value;
		} catch {
			// keep polling
		}
		if (opts.signal?.aborted) return null;
		if (waited + interval > timeout) break;
		await sleep(interval);
	}
	return null;
}

/** Resolves the first review whose createdAt is later than `since`, or null on timeout or abort. */
export function pollForReview<T extends { createdAt: string }>(
	load: () => Promise<T | null>,
	since: string,
	opts: PollOptions = {}
): Promise<T | null> {
	return pollUntil(load, (review) => review.createdAt > since, opts);
}

/** The waits before each resend after `in_flight` (about half a minute in all). */
export const IN_FLIGHT_BACKOFF_MS: readonly number[] = [2000, 4000, 8000, 16000];

/**
 * sendRetryingInFlight sends, and sends again after each wait of
 * IN_FLIGHT_BACKOFF_MS while the server answers `in_flight` (the request did
 * not run); the last `in_flight`, an abort or any other error is thrown.
 */
export async function sendRetryingInFlight<T>(send: () => Promise<T>, opts: Pick<PollOptions, 'sleep' | 'signal'> = {}): Promise<T> {
	const sleep = opts.sleep ?? realSleep;
	for (let attempt = 0; ; attempt++) {
		try {
			return await send();
		} catch (err) {
			const inFlight = err instanceof ApiError && err.code === 'in_flight';
			if (!inFlight || attempt >= IN_FLIGHT_BACKOFF_MS.length || opts.signal?.aborted) throw err;
			await sleep(IN_FLIGHT_BACKOFF_MS[attempt]);
			if (opts.signal?.aborted) throw err;
		}
	}
}
