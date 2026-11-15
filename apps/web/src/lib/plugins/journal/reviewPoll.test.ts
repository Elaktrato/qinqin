import { describe, expect, it } from 'vitest';
import { pollForReview } from './reviewPoll';
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
