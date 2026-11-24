import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { PartialPushError, pushChunks, stampOf } from './push';

describe('stampOf: last write wins on this stamp', () => {
	it('is the clock, but never earlier than one millisecond after what the server holds', () => {
		const now = Date.parse('2026-02-01T10:00:00Z');
		expect(stampOf(now, undefined)).toBe('2026-02-01T10:00:00.000Z');
		expect(stampOf(now, '2026-01-01T00:00:00Z')).toBe('2026-02-01T10:00:00.000Z');
		expect(stampOf(now, '2026-03-01T00:00:00Z')).toBe('2026-03-01T00:00:00.001Z');
		expect(stampOf(now, 'garbage')).toBe('2026-02-01T10:00:00.000Z');
	});
});

describe('pushChunks', () => {
	const answers: unknown[] = [];
	beforeEach(() => {
		answers.length = 0;
		vi.stubGlobal('localStorage', { getItem: () => 'tok' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(answers.shift() ?? { dataAccepted: 1, dataSkipped: 0, dataRefused: 0 }), { status: 200 }))
		);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('posts each chunk to the push route and reports progress', async () => {
		const progress: number[] = [];
		const bodies: [number, number][] = [];
		await pushChunks(3, { chunk: 2, onProgress: (done) => progress.push(done), now: () => 0 }, (from, to) => {
			bodies.push([from, to]);
			return { pluginData: [] };
		});
		expect(bodies).toEqual([[0, 2], [2, 3]]);
		expect(progress).toEqual([1, 2]);
		expect(vi.mocked(fetch).mock.calls.map(([url, init]) => `${init?.method} ${String(url)}`)).toEqual([
			'POST /api/sync/push',
			'POST /api/sync/push'
		]);
	});

	it('a skipped or refused row stops the push: PartialPushError with what was done', async () => {
		answers.push({ dataAccepted: 2, dataSkipped: 0, dataRefused: 0 }, { dataAccepted: 0, dataSkipped: 1, dataRefused: 1 });
		const err = await pushChunks(4, { chunk: 2, now: () => 0 }, () => ({})).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PartialPushError);
		expect(err).toMatchObject({ done: 2, skipped: 2 });
	});

	it('a failed request is a PartialPushError too, and `after` still runs for every chunk sent', async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
		const after: number[] = [];
		const err = await pushChunks(2, { chunk: 1, now: () => 0, after: (from) => after.push(from) }, () => ({})).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(PartialPushError);
		expect(err).toMatchObject({ done: 0, skipped: 0 });
		expect(after).toEqual([0]);
	});
});
