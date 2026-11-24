// After a proxy cut a long review (or ideas request), the server still
// writes the document. Poll the stored one until one newer than `since` shows up.

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
