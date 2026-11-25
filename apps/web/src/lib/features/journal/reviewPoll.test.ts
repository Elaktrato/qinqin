import { describe, expect, it } from 'vitest';
import { ApiError } from '$lib/api/client';
import { IN_FLIGHT_BACKOFF_MS, pollForReview, sendRetryingInFlight } from './reviewPoll';
import type { Review } from './types';

function review(createdAt: string): Review {
	return {
		entryId: 'e',
		textHash: 'h',
		annotations: [],
		overall: { summary: '', strengths: [], focus: [] },
		model: 'm',
		dropped: { notFound: 0, wrongScript: 0, noChange: 0, overlap: 0, empty: 0, tooMany: 0 },
		createdAt
	};
}

const noSleep = async () => {};

describe('pollForReview', () => {
	it('returns the first review newer than since', async () => {
		const answers = [null, review('2026-01-01T00:00:00Z'), review('2026-01-03T00:00:00Z')];
		let calls = 0;
		const got = await pollForReview(async () => answers[calls++], '2026-01-02T00:00:00Z', {
			sleep: noSleep
		});
		expect(got?.createdAt).toBe('2026-01-03T00:00:00Z');
		expect(calls).toBe(3);
	});

	it('ignores an equal or older review', async () => {
		let calls = 0;
		const got = await pollForReview(
			async () => {
				calls++;
				return review('2026-01-02T00:00:00Z');
			},
			'2026-01-02T00:00:00Z',
			{ sleep: noSleep, intervalMs: 5000, timeoutMs: 15000 }
		);
		expect(got).toBeNull();
		expect(calls).toBeLessThanOrEqual(4);
	});

	it('gives up with null after the timeout and loads at most timeout/interval + 1 times', async () => {
		let calls = 0;
		const slept: number[] = [];
		const got = await pollForReview(
			async () => {
				calls++;
				return null;
			},
			'x',
			{
				intervalMs: 5000,
				timeoutMs: 180000,
				sleep: async (ms) => {
					slept.push(ms);
				}
			}
		);
		expect(got).toBeNull();
		expect(calls).toBe(37);
		expect(slept.every((ms) => ms === 5000)).toBe(true);
	});

	it('keeps polling through a failed load', async () => {
		let calls = 0;
		const got = await pollForReview(
			async () => {
				calls++;
				if (calls === 1) throw new TypeError('Failed to fetch');
				return review('2026-02-01T00:00:00Z');
			},
			'2026-01-01T00:00:00Z',
			{ sleep: noSleep }
		);
		expect(got?.createdAt).toBe('2026-02-01T00:00:00Z');
	});

	it('stops when aborted', async () => {
		const ctl = new AbortController();
		let calls = 0;
		const got = await pollForReview(
			async () => {
				calls++;
				ctl.abort();
				return null;
			},
			'x',
			{ sleep: noSleep, signal: ctl.signal }
		);
		expect(got).toBeNull();
		expect(calls).toBe(1);
	});
});

import { pollUntil } from './reviewPoll';

describe('pollUntil', () => {
	it('returns the first load the condition accepts; a failed load counts as not yet', async () => {
		const answers: (number | Error)[] = [1, new Error('x'), 2, 3];
		let calls = 0;
		const got = await pollUntil(
			async () => {
				const a = answers[calls++];
				if (a instanceof Error) throw a;
				return a;
			},
			(n) => n >= 2,
			{ sleep: noSleep }
		);
		expect([got, calls]).toEqual([2, 3]);
	});

	it('gives up after the timeout, counted in sleeps', async () => {
		let sleeps = 0;
		const got = await pollUntil(async () => 0, () => false, { intervalMs: 10, timeoutMs: 30, sleep: async () => void sleeps++ });
		expect([got, sleeps]).toEqual([null, 3]);
	});
});

describe('sendRetryingInFlight', () => {
	const inFlight = () => new ApiError(409, JSON.stringify({ error: 'in_flight', message: 'x' }));

	it('sends again with backoff while another call holds the slot', async () => {
		const sleeps: number[] = [];
		let n = 0;
		const got = await sendRetryingInFlight(
			async () => {
				if (n++ < 2) throw inFlight();
				return 'ok';
			},
			{ sleep: async (ms) => void sleeps.push(ms) }
		);
		expect(got).toBe('ok');
		expect(sleeps).toEqual(IN_FLIGHT_BACKOFF_MS.slice(0, 2));
	});

	it('gives up after the last backoff with the in_flight error, and passes any other error at once', async () => {
		const sleeps: number[] = [];
		let n = 0;
		const err = await sendRetryingInFlight(
			async () => {
				n++;
				throw inFlight();
			},
			{ sleep: async (ms) => void sleeps.push(ms) }
		).catch((e: unknown) => e);
		expect((err as ApiError).code).toBe('in_flight');
		expect(n).toBe(IN_FLIGHT_BACKOFF_MS.length + 1);
		expect(sleeps).toEqual([...IN_FLIGHT_BACKOFF_MS]);
		const lost = new TypeError('network');
		expect(await sendRetryingInFlight(async () => Promise.reject(lost), { sleep: async () => {} }).catch((e: unknown) => e)).toBe(lost);
	});

	it('stops on abort', async () => {
		const stop = new AbortController();
		let n = 0;
		const err = await sendRetryingInFlight(
			async () => {
				n++;
				stop.abort();
				throw inFlight();
			},
			{ sleep: async () => {}, signal: stop.signal }
		).catch((e: unknown) => e);
		expect(n).toBe(1);
		expect((err as ApiError).code).toBe('in_flight');
	});
});
