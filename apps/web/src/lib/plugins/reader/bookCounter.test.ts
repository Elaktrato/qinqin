import { describe, expect, it, vi } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import { createBookCounter } from './bookCounter';
import type { Run } from './paragraphText';

// Every chapter is one paragraph "你好" plus its number in Han (一, 二, ...).
const NUM = '〇一二三四五六七八九';
const chapterText = (n: number) => `你好${NUM[n]}`;
const match = (start: number, end: number, surface: string, id: number): SegmentMatch => ({
	surface,
	start,
	end,
	lemma: surface,
	reason: '',
	entries: [{ id, kind: 'word' }]
});
const segmentOf = (text: string): SegmentMatch[] => {
	const out = [match(0, 2, '你好', 1)];
	if (text.length > 2) out.push(match(2, 3, text[2], 10 + NUM.indexOf(text[2])));
	return out;
};

function setup(opts: { failChapter?: number; failSegment?: () => boolean; delay?: number } = {}) {
	const getChapter = vi.fn(async (n: number) => {
		if (n === opts.failChapter) throw new Error('offline');
		return { paragraphs: [[{ text: chapterText(n) }]] as Run[][] };
	});
	let inFlight = 0;
	let maxInFlight = 0;
	const segment = vi.fn(async (text: string) => {
		inFlight++;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise((r) => setTimeout(r, opts.delay ?? 0));
		inFlight--;
		if (opts.failSegment?.()) throw new Error('x');
		return segmentOf(text);
	});
	const counter = createBookCounter({ getChapter, segment, displayRuns: (p) => p, lang: 'zh' });
	return { counter, getChapter, segment, max: () => maxInFlight };
}

describe('createBookCounter', () => {
	it('tallies every chapter with progress', async () => {
		const { counter } = setup();
		const progress: [number, number][] = [];
		const { failed } = await counter.count(3, (d, t) => progress.push([d, t]));
		expect(failed).toEqual([]);
		expect(progress).toEqual([[1, 3], [2, 3], [3, 3]]);
		expect([...counter.tallies.keys()].sort()).toEqual([0, 1, 2]);
		expect(counter.tallies.get(1)?.tokens).toBe(2);
		expect(counter.tallies.get(1)?.types.get(11)?.first).toEqual({ chapter: 1, p: 0, start: 2 });
	});

	it('a chapter put by the reader is not fetched', async () => {
		const { counter, getChapter } = setup();
		counter.put(1, { types: new Map(), tokens: 0, unmatched: 0 });
		await counter.count(3, () => {});
		expect(getChapter.mock.calls.map((c) => c[0]).sort()).toEqual([0, 2]);
		expect(counter.tallies.get(1)?.tokens).toBe(0);
	});

	it('a failing chapter is listed and retried by the next count', async () => {
		const s = setup({ failChapter: 1 });
		expect((await s.counter.count(3, () => {})).failed).toEqual([1]);
		expect(s.counter.tallies.has(1)).toBe(false);
		const calls = s.getChapter.mock.calls.length;
		expect((await s.counter.count(3, () => {})).failed).toEqual([1]);
		expect(s.getChapter.mock.calls.length).toBe(calls + 1);
	});

	it('a chapter with a failed segment request is not tallied', async () => {
		let n = 0;
		const s = setup({ failSegment: () => ++n === 2 });
		const { failed } = await s.counter.count(3, () => {});
		expect(failed).toEqual([1]);
		expect(s.counter.tallies.has(1)).toBe(false);
	});

	it('abort stops further requests', async () => {
		const s = setup({ delay: 5 });
		const run = s.counter.count(5, (done) => {
			if (done === 1) s.counter.abort();
		});
		await run;
		const after = s.segment.mock.calls.length;
		await new Promise((r) => setTimeout(r, 30));
		expect(s.segment.mock.calls.length).toBe(after);
		expect(s.counter.tallies.size).toBeLessThan(5);
	});

	it('never more than the concurrency in flight', async () => {
		const getChapter = async () => ({ paragraphs: Array.from({ length: 6 }, () => [{ text: '你好'.repeat(1500) }]) as Run[][] });
		let inFlight = 0;
		let max = 0;
		const segment = async () => {
			inFlight++;
			max = Math.max(max, inFlight);
			await new Promise((r) => setTimeout(r, 2));
			inFlight--;
			return [];
		};
		const counter = createBookCounter({ getChapter, segment, displayRuns: (p) => p, lang: 'zh', concurrency: 2 });
		await counter.count(2, () => {});
		expect(max).toBe(2);
	});
});
