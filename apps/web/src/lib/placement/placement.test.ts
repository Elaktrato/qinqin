import { describe, expect, it } from 'vitest';
import { answer, currentItem, placementResult, startPlacement, type PlacementState } from './placement';

/** Runs a whole test against a learner who knows exactly the levels 1..knows. */
function run(counts: number[], seed: number, knows: number, slip = (_: number, __: number) => false) {
	let state = startPlacement({ counts, seed });
	const asked: { level: number; index: number }[] = [];
	let guard = 0;
	for (let item = currentItem(state); item !== null; item = currentItem(state)) {
		asked.push(item);
		const known = item.level <= knows && !slip(item.level, asked.length);
		state = answer(state, known);
		if (++guard > 500) throw new Error('does not end');
	}
	return { state, asked };
}

describe('placement', () => {
	it('places a learner who knows nothing at 0 and one who knows everything at the top', () => {
		for (const seed of [1, 2, 3]) {
			expect(placementResult(run([20, 20, 20, 20, 20, 20], seed, 0).state).placed).toBe(0);
			expect(placementResult(run([20, 20, 20, 20, 20, 20], seed, 6).state).placed).toBe(6);
		}
	});

	it('finds every true level of a consistent learner', () => {
		for (let knows = 0; knows <= 9; knows++) {
			const { state } = run(Array(9).fill(30), 7 + knows, knows);
			expect(placementResult(state).placed).toBe(knows);
		}
	});

	it('is deterministic given the seed and differs between seeds', () => {
		const a = run([40, 40, 40, 40], 42, 2).asked;
		const b = run([40, 40, 40, 40], 42, 2).asked;
		const c = run([40, 40, 40, 40], 43, 2).asked;
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
	});

	it('is short: at most 4 items per probe and ceil(log2(L+1)) probes', () => {
		for (const levels of [1, 3, 6, 9]) {
			for (let knows = 0; knows <= levels; knows++) {
				const { asked } = run(Array(levels).fill(50), 5, knows);
				expect(asked.length).toBeLessThanOrEqual(4 * Math.ceil(Math.log2(levels + 1)));
			}
		}
	});

	it('never repeats an item inside a probe and stays inside the level', () => {
		const counts = [5, 3, 50];
		const { asked } = run(counts, 9, 1);
		const seen = new Set<string>();
		for (const item of asked) {
			expect(item.index).toBeGreaterThanOrEqual(0);
			expect(item.index).toBeLessThan(counts[item.level - 1]);
			const key = `${item.level}:${item.index}`;
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}
	});

	it('stops a probe early once it is decided', () => {
		// Knows everything: each probe needs 3 known answers, the 4th item is never asked.
		const { asked } = run([20, 20, 20], 1, 3);
		const perLevel = new Map<number, number>();
		for (const a of asked) perLevel.set(a.level, (perLevel.get(a.level) ?? 0) + 1);
		for (const n of perLevel.values()) expect(n).toBe(3);
		// Knows nothing: 2 unknown answers fail a probe of 4.
		const none = run([20, 20, 20], 1, 0).asked;
		const per = new Map<number, number>();
		for (const a of none) per.set(a.level, (per.get(a.level) ?? 0) + 1);
		for (const n of per.values()) expect(n).toBe(2);
	});

	it('a probe over a small level asks what there is', () => {
		const { asked } = run([2, 2], 3, 2);
		expect(asked.every((a) => a.index < 2)).toBe(true);
		expect(placementResult(run([2, 2], 3, 2).state).placed).toBe(2);
	});

	it('a single wrong click does not fail a level, two do', () => {
		const slip = run(Array(4).fill(30), 11, 4, (_l, n) => n === 1);
		expect(placementResult(slip.state).placed).toBe(4);
	});

	it('records the answers and finishes', () => {
		const { state } = run([10, 10, 10], 4, 2);
		const result = placementResult(state);
		expect(result.done).toBe(true);
		expect(result.answered).toBe(state.log.length);
		expect(currentItem(state)).toBeNull();
	});

	it('answering a finished test changes nothing', () => {
		const { state } = run([10, 10], 4, 1);
		expect(answer(state, true)).toBe(state);
	});

	it('has no items without levels and is done at once', () => {
		const state: PlacementState = startPlacement({ counts: [], seed: 1 });
		expect(currentItem(state)).toBeNull();
		expect(placementResult(state)).toMatchObject({ done: true, placed: 0, answered: 0 });
	});

	it('a level with no items is a caller error', () => {
		expect(() => startPlacement({ counts: [3, 0], seed: 1 })).toThrow();
	});

	it('an unfinished test reports the best level passed so far', () => {
		let state = startPlacement({ counts: [10, 10, 10, 10], seed: 2 });
		for (let i = 0; i < 3; i++) state = answer(state, true);
		const r = placementResult(state);
		expect(r.done).toBe(false);
		expect(r.placed).toBe(2);
	});
});
