import { describe, expect, it } from 'vitest';
import { knownIndex, type KnownIndex } from '$lib/study/known';
import type { LevelMembers } from './declare';
import { SAMPLE_SIZE, checkEstimate, planCheck } from './levelCheck';

const level = (id: number, ids: number[]): LevelMembers => ({ id, name: `L${id}`, entryIds: ids });
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const LEVELS = [level(1, range(1, 10)), level(2, range(11, 30)), level(3, range(31, 60))];

/** An index where `marks` are known and `carded` have a card that is not mastered yet. */
function index(marks: number[], carded: number[] = []): KnownIndex {
	const cards = carded.map((entryId) => ({ id: `c${entryId}`, entryId, kind: 'vocab' })) as never;
	return knownIndex(cards, () => ({ stability: 0.1 }), marks);
}

describe('planCheck', () => {
	it('counts known, learning and unseen over the levels up to the target, per level and in total', () => {
		const plan = planCheck({ levels: LEVELS, target: 2, index: index([1, 2, 3, 11], [4, 5, 12]), seed: 1 });
		expect(plan.levels.map((l) => l.name)).toEqual(['L1', 'L2']);
		expect(plan.levels[0]).toMatchObject({ known: 3, learning: 2, unseen: 5, total: 10 });
		expect(plan.levels[1]).toMatchObject({ known: 1, learning: 1, unseen: 18, total: 20 });
		expect(plan.total).toEqual({ known: 4, learning: 3, unseen: 23, total: 30 });
	});

	it('counts an entry once, at its first level', () => {
		const plan = planCheck({ levels: [level(1, [1, 2]), level(2, [2, 3])], target: 2, index: index([]), seed: 1 });
		expect(plan.total.total).toBe(3);
		expect(plan.levels[1].total).toBe(1);
	});

	it('samples only entries the app does not know yet, distinct, at most SAMPLE_SIZE', () => {
		const known = range(1, 20);
		const plan = planCheck({ levels: LEVELS, target: 3, index: index(known), seed: 7 });
		expect(plan.sample).toHaveLength(SAMPLE_SIZE);
		expect(new Set(plan.sample).size).toBe(SAMPLE_SIZE);
		for (const id of plan.sample) {
			expect(id).toBeGreaterThanOrEqual(21);
			expect(id).toBeLessThanOrEqual(60);
		}
	});

	it('samples the whole pool when it is smaller than the sample', () => {
		const plan = planCheck({ levels: LEVELS, target: 1, index: index(range(1, 7)), seed: 3 });
		expect([...plan.sample].sort((a, b) => a - b)).toEqual([8, 9, 10]);
	});

	it('is deterministic for a seed and differs between seeds', () => {
		const a = planCheck({ levels: LEVELS, target: 3, index: index([]), seed: 5 });
		const b = planCheck({ levels: LEVELS, target: 3, index: index([]), seed: 5 });
		const c = planCheck({ levels: LEVELS, target: 3, index: index([]), seed: 6 });
		expect(a.sample).toEqual(b.sample);
		expect(a.sample).not.toEqual(c.sample);
	});

	it('has an empty sample when everything is known, and rejects a target outside the levels', () => {
		expect(planCheck({ levels: LEVELS, target: 1, index: index(range(1, 10)), seed: 1 }).sample).toEqual([]);
		expect(() => planCheck({ levels: LEVELS, target: 0, index: index([]), seed: 1 })).toThrow();
		expect(() => planCheck({ levels: LEVELS, target: 4, index: index([]), seed: 1 })).toThrow();
	});
});

describe('checkEstimate', () => {
	// 30 entries, 10 known by data, a sample of 20 = the whole rest.
	const plan = planCheck({ levels: LEVELS, target: 2, index: index(range(1, 10)), seed: 1 });
	const yes = (n: number): boolean[] => [...Array(n).fill(true), ...Array(plan.sample.length - n).fill(false)];

	it('adds the sampled share of the not-yet-known entries to what the data knows', () => {
		const e = checkEstimate(plan, yes(10));
		expect(e.asked).toBe(20);
		expect(e.yes).toBe(10);
		expect(e.share).toBeCloseTo((10 + 0.5 * 20) / 30);
		expect(e.low).toBeLessThan(e.share);
		expect(e.high).toBeGreaterThan(e.share);
	});

	it('answering "not sure" to everything leaves exactly the data coverage; the range stays above it', () => {
		const e = checkEstimate(plan, yes(0));
		expect(e.share).toBeCloseTo(10 / 30);
		expect(e.low).toBeCloseTo(10 / 30);
		expect(e.high).toBeGreaterThan(e.share);
		expect(e.band).toBe('early');
	});

	it('knowing everything reaches ready, and the range never leaves 0..1', () => {
		const e = checkEstimate(plan, yes(20));
		expect(e.share).toBe(1);
		expect(e.high).toBeLessThanOrEqual(1);
		expect(e.band).toBe('ready');
	});

	it('with no questions to ask the data decides', () => {
		const full = planCheck({ levels: LEVELS, target: 1, index: index(range(1, 10)), seed: 1 });
		expect(checkEstimate(full, [])).toMatchObject({ share: 1, low: 1, high: 1, asked: 0, band: 'ready' });
	});

	it('bands follow the share: early, partway, close, ready', () => {
		const band = (n: number) => checkEstimate(plan, yes(n)).band;
		expect(band(0)).toBe('early');
		expect(band(8)).toBe('partway'); // (10+8)/30 = 0.6
		expect(band(14)).toBe('close'); // 0.8
		expect(band(18)).toBe('ready'); // 0.93
	});

	it('points at the lowest level that is not ready yet, or at none', () => {
		const e = checkEstimate(plan, yes(10));
		expect(e.perLevel.map((l) => l.name)).toEqual(['L1', 'L2']);
		expect(e.perLevel[0].share).toBe(1);
		expect(e.next).toEqual({ position: 2, name: 'L2' });
		expect(checkEstimate(plan, yes(20)).next).toBeNull();
	});
});
