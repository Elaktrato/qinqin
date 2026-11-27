import { describe, expect, it } from 'vitest';
import { knownIndex, type KnownIndex } from '$lib/studycore/known';
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

describe('stratified sample', () => {
	it('shares the questions evenly over the levels, a small pool giving all it has', () => {
		const plan = planCheck({ levels: [level(1, range(1, 3)), level(2, range(4, 50)), level(3, range(51, 100))], target: 3, index: index([]), seed: 2 });
		const per = [0, 0, 0];
		for (const l of plan.sampleLevel) per[l] += 1;
		expect(per).toEqual([3, 9, 8]);
		expect(plan.sample).toHaveLength(SAMPLE_SIZE);
	});

	it('draws each entry from its own level', () => {
		const plan = planCheck({ levels: LEVELS, target: 3, index: index([]), seed: 4 });
		plan.sample.forEach((id, i) => {
			expect(LEVELS[plan.sampleLevel[i]].entryIds).toContain(id);
		});
	});
});

describe('checkEstimate', () => {
	// 30 entries, 10 known by data, 10 of the 20 rest asked (all in L2).
	const plan = planCheck({ levels: LEVELS, target: 2, index: index(range(1, 10)), seed: 1, sampleSize: 10 });
	const yes = (n: number): boolean[] => [...Array(n).fill(true), ...Array(plan.sample.length - n).fill(false)];

	it('adds the sampled share of the not-yet-known entries to what the data knows', () => {
		const e = checkEstimate(plan, yes(5));
		expect(e.asked).toBe(10);
		expect(e.yes).toBe(5);
		expect(e.share).toBeCloseTo((10 + 0.5 * 20) / 30);
		expect(e.low).toBeLessThan(e.share);
		expect(e.high).toBeGreaterThan(e.share);
		expect(e.exact).toBe(false);
	});

	it('answering "not sure" to everything leaves exactly the data coverage; the range stays above it', () => {
		const e = checkEstimate(plan, yes(0));
		expect(e.share).toBeCloseTo(10 / 30);
		expect(e.low).toBeCloseTo(10 / 30);
		expect(e.high).toBeGreaterThan(e.share);
		expect(e.band).toBe('early');
	});

	it('knowing everything reaches ready, and the range never leaves 0..1', () => {
		const e = checkEstimate(plan, yes(10));
		expect(e.share).toBe(1);
		expect(e.high).toBeLessThanOrEqual(1);
		expect(e.band).toBe('ready');
	});

	it('asking the whole pool is exact: no range, low = share = high', () => {
		const whole = planCheck({ levels: LEVELS, target: 2, index: index(range(1, 10)), seed: 1 });
		expect(whole.sample).toHaveLength(20);
		const e = checkEstimate(whole, [...Array(10).fill(true), ...Array(10).fill(false)]);
		expect(e.exact).toBe(true);
		expect(e.low).toBeCloseTo(e.share);
		expect(e.high).toBeCloseTo(e.share);
		expect(e.share).toBeCloseTo(20 / 30);
	});

	it('with no questions to ask the data decides', () => {
		const full = planCheck({ levels: LEVELS, target: 1, index: index(range(1, 10)), seed: 1 });
		expect(checkEstimate(full, [])).toMatchObject({ share: 1, low: 1, high: 1, asked: 0, band: 'ready', exact: true });
	});

	it('bands follow the share: early, partway, close, ready', () => {
		const band = (n: number) => checkEstimate(plan, yes(n)).band;
		expect(band(0)).toBe('early');
		expect(band(4)).toBe('partway'); // (10+8)/30 = 0.6
		expect(band(7)).toBe('close'); // (10+14)/30 = 0.8
		expect(band(9)).toBe('ready'); // (10+18)/30 = 0.93
	});

	it('points at the lowest level that is not ready yet, or at none', () => {
		const e = checkEstimate(plan, yes(5));
		expect(e.perLevel.map((l) => l.name)).toEqual(['L1', 'L2']);
		expect(e.perLevel[0].share).toBe(1);
		expect(e.next).toEqual({ position: 2, name: 'L2' });
		expect(checkEstimate(plan, yes(10)).next).toBeNull();
	});
});

describe('checkEstimate with outside knowledge (levels 1-3 known, target 4)', () => {
	// Four levels of 40, nothing known by the app; the learner knows levels 1-3 and nothing of 4.
	const four = [1, 2, 3, 4].map((n) => level(n, range((n - 1) * 40 + 1, n * 40)));
	const plan = planCheck({ levels: four, target: 4, index: index([]), seed: 9 });
	const answer = (knownLevels: number[]): boolean[] => plan.sampleLevel.map((l) => knownLevels.includes(l));

	it('estimates each level on its own, not one pooled rate', () => {
		const e = checkEstimate(plan, answer([0, 1, 2]));
		expect(e.perLevel.map((l) => l.share)).toEqual([1, 1, 1, 0]);
		expect(e.perLevel.every((l) => !l.pooled && l.asked === 5)).toBe(true);
	});

	it('sends the learner to level 4, not back to level 1', () => {
		const e = checkEstimate(plan, answer([0, 1, 2]));
		expect(e.next).toEqual({ position: 4, name: 'L4' });
	});

	it('sends a learner who knows nothing to level 1, and one who knows all to none', () => {
		expect(checkEstimate(plan, answer([])).next).toEqual({ position: 1, name: 'L1' });
		expect(checkEstimate(plan, answer([0, 1, 2, 3])).next).toBeNull();
	});

	it('a level with too few answers borrows the pooled rate and says so', () => {
		const many = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => level(n, range((n - 1) * 40 + 1, n * 40)));
		const p = planCheck({ levels: many, target: 8, index: index([]), seed: 9, sampleSize: 16 });
		const e = checkEstimate(
			p,
			p.sample.map(() => true)
		);
		expect(e.perLevel.every((l) => l.asked === 2 && l.pooled)).toBe(true);
		expect(e.share).toBe(1);
	});
});
