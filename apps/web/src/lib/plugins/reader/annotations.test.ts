import { describe, expect, it, vi } from 'vitest';
import type { SegmentMatch } from '$lib/api/types';
import { chunkParagraphs, createAnnotationLoader } from './annotations';

const cp = (s: string) => Array.from(s).length;

describe('chunkParagraphs', () => {
	it('keeps every chunk within the limit, astral characters counted once', () => {
		const texts = Array.from({ length: 10 }, () => '𠮷'.repeat(30));
		const chunks = chunkParagraphs(texts, 0, 100);
		for (const c of chunks) expect(cp(c.text)).toBeLessThanOrEqual(100);
		const covered = chunks.flatMap((c) => c.parts.map((p) => p.p));
		expect(covered.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('visits the visible paragraph first, then onward, then backward', () => {
		const texts = ['a', 'b', 'c', 'd', 'e'];
		const order = chunkParagraphs(texts, 2, 1).flatMap((c) => c.parts.map((p) => p.p));
		expect(order).toEqual([2, 3, 4, 1, 0]);
	});

	it('records offsets so a part can be located in the chunk text', () => {
		const [chunk] = chunkParagraphs(['你好', '世界'], 0, 100);
		expect(chunk.text).toBe('你好\n世界');
		expect(chunk.parts).toEqual([
			{ p: 0, from: 0, at: 0, len: 2 },
			{ p: 1, from: 0, at: 3, len: 2 }
		]);
	});

	it('splits a long paragraph after sentence punctuation, else hard', () => {
		const sentence = '你'.repeat(40) + '。';
		const chunks = chunkParagraphs([sentence.repeat(3)], 0, 100);
		expect(chunks.length).toBe(2);
		expect(chunks[0].text.endsWith('。')).toBe(true);
		const hard = chunkParagraphs(['你'.repeat(250)], 0, 100);
		expect(hard.map((c) => cp(c.text))).toEqual([100, 100, 50]);
		// Parts of the same paragraph continue where the last one ended.
		expect(hard.map((c) => c.parts[0].from)).toEqual([0, 100, 200]);
	});

	it('skips empty paragraphs', () => {
		expect(chunkParagraphs(['', '  ', 'x'], 0, 10).flatMap((c) => c.parts.map((p) => p.p))).toEqual([2]);
	});
});

function match(start: number, end: number): SegmentMatch {
	return { surface: 'x', start, end, lemma: 'x', reason: '', entries: [] };
}

describe('createAnnotationLoader', () => {
	it('maps matches back to paragraph offsets across joined paragraphs', async () => {
		// chunk text: 你好\n世界 ; matches at 0-2 and 3-5
		const segment = vi.fn(async () => [match(0, 2), match(3, 5)]);
		const loader = createAnnotationLoader({ segment });
		const got = new Map<number, SegmentMatch[]>();
		await loader.load('k', ['你好', '世界'], 0, (p, m) => got.set(p, m));
		expect(got.get(0)).toEqual([match(0, 2)]);
		expect(got.get(1)).toEqual([match(0, 2)]);
	});

	it('shifts matches of a later part of a long paragraph', async () => {
		const segment = vi.fn(async (text: string) => (text.length > 50 ? [match(0, 2)] : [match(0, 2)]));
		const loader = createAnnotationLoader({ segment, maxCodePoints: 100 });
		const got = new Map<number, SegmentMatch[]>();
		await loader.load('k', ['你'.repeat(150)], 0, (p, m) => got.set(p, m));
		expect(got.get(0)).toEqual([match(0, 2), match(100, 102)]);
	});

	it('drops a match that crosses a paragraph separator', async () => {
		const loader = createAnnotationLoader({ segment: async () => [match(1, 4)] });
		const got = new Map<number, SegmentMatch[]>();
		await loader.load('k', ['你好', '世界'], 0, (p, m) => got.set(p, m));
		expect(got.get(0)).toEqual([]);
		expect(got.get(1)).toEqual([]);
	});

	it('never runs more than two requests at once', async () => {
		let running = 0;
		let peak = 0;
		const segment = async () => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((r) => setTimeout(r, 5));
			running--;
			return [];
		};
		const loader = createAnnotationLoader({ segment, maxCodePoints: 10 });
		await loader.load('k', Array.from({ length: 12 }, () => '你好你好你好你好你好'), 0, () => {});
		expect(peak).toBe(2);
	});

	it('serves a cached chapter without a request', async () => {
		const segment = vi.fn(async () => [match(0, 2)]);
		const loader = createAnnotationLoader({ segment });
		await loader.load('k', ['你好'], 0, () => {});
		expect(segment).toHaveBeenCalledTimes(1);
		const got: number[] = [];
		await loader.load('k', ['你好'], 0, (p) => got.push(p));
		expect(segment).toHaveBeenCalledTimes(1);
		expect(got).toEqual([0]);
	});

	it('keeps only the six latest chapters', async () => {
		const segment = vi.fn(async () => []);
		const loader = createAnnotationLoader({ segment });
		for (let i = 0; i < 7; i++) await loader.load(`k${i}`, ['你好'], 0, () => {});
		await loader.load('k0', ['你好'], 0, () => {});
		expect(segment).toHaveBeenCalledTimes(8);
		await loader.load('k6', ['你好'], 0, () => {});
		expect(segment).toHaveBeenCalledTimes(8);
	});

	it('abort stops callbacks and the signal reaches the request', async () => {
		let signal: AbortSignal | undefined;
		const segment = (_t: string, s?: AbortSignal) =>
			new Promise<SegmentMatch[]>((resolve) => {
				signal = s;
				setTimeout(() => resolve([match(0, 2)]), 5);
			});
		const loader = createAnnotationLoader({ segment });
		const seen = vi.fn();
		const done = loader.load('k', ['你好'], 0, seen);
		loader.abort();
		await done;
		expect(signal?.aborted).toBe(true);
		expect(seen).not.toHaveBeenCalled();
	});

	it('a new load aborts the previous one', async () => {
		const segment = vi.fn(async (_t: string, s?: AbortSignal) => {
			await new Promise((r) => setTimeout(r, 5));
			return s?.aborted ? [] : [match(0, 2)];
		});
		const loader = createAnnotationLoader({ segment });
		const first = vi.fn();
		const a = loader.load('a', ['你好'], 0, first);
		const b = loader.load('b', ['你好'], 0, () => {});
		await Promise.all([a, b]);
		expect(first).not.toHaveBeenCalled();
	});

	it('a failed chunk leaves its paragraphs plain and is retried on the next load', async () => {
		let fail = true;
		const segment = vi.fn(async () => {
			if (fail) throw new Error('boom');
			return [match(0, 2)];
		});
		const loader = createAnnotationLoader({ segment });
		const seen = vi.fn();
		const result = await loader.load('k', ['你好'], 0, seen);
		expect(seen).not.toHaveBeenCalled();
		expect(result.failed).toBe(1);
		fail = false;
		const got = new Map<number, SegmentMatch[]>();
		const again = await loader.load('k', ['你好'], 0, (p, m) => got.set(p, m));
		expect(again.failed).toBe(0);
		expect(got.get(0)).toEqual([match(0, 2)]);
		expect(segment).toHaveBeenCalledTimes(2);
	});
});
