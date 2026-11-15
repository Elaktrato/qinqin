import { createEmptyCard, default_w, forgetting_curve, fsrs, Rating, type Grade } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_W } from './params';
import { daysBetween, numberNum, replay, retrievability, type Step } from './model';

function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const RATING: Record<number, Grade> = {
	1: Rating.Again,
	2: Rating.Hard,
	3: Rating.Good,
	4: Rating.Easy
};

interface History {
	times: Date[];
	grades: (1 | 2 | 3 | 4)[];
}

function randomHistory(rand: () => number): History {
	const n = 1 + Math.floor(rand() * 30);
	let ms = Date.UTC(2026, 0, 1) + Math.floor(rand() * 864e5);
	const times: Date[] = [];
	const grades: (1 | 2 | 3 | 4)[] = [];
	for (let i = 0; i < n; i++) {
		if (i > 0) {
			const kind = rand();
			if (kind < 0.15) {
				// equal timestamp
			} else if (kind < 0.3) {
				ms += Math.floor(rand() * 3600e3 * 3);
			} else {
				ms += Math.floor(rand() * 61) * 864e5 + Math.floor(rand() * 864e5);
			}
		}
		times.push(new Date(ms));
		grades.push((1 + Math.floor(rand() * 4)) as 1 | 2 | 3 | 4);
	}
	return { times, grades };
}

function stepsOf(h: History): Step[] {
	return h.times.map((t, i) => ({
		t: i === 0 ? 0 : daysBetween(h.times[i - 1].toISOString(), t.toISOString()),
		g: h.grades[i]
	}));
}

function reference(w: readonly number[], h: History): { s: number; d: number } {
	const scheduler = fsrs({ w: [...w] });
	let card = createEmptyCard(h.times[0]);
	h.times.forEach((t, i) => {
		card = scheduler.next(card, t, RATING[h.grades[i]]).card;
	});
	return { s: card.stability, d: card.difficulty };
}

function perturbed(rand: () => number): number[] {
	const w = [...DEFAULT_W];
	for (const i of [4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) {
		w[i] *= 0.7 + rand() * 0.6;
	}
	w[7] = 0.05;
	w[9] = Math.min(w[9], 0.8);
	w[12] = Math.min(w[12], 0.25);
	w[13] = Math.min(w[13], 0.9);
	w[15] = Math.min(w[15], 1);
	w[17] = Math.min(w[17], 2);
	w[18] = Math.min(w[18], 2);
	w[20] = Math.min(Math.max(w[20], 0.1), 0.8);
	return w;
}

describe('model parity with ts-fsrs', () => {
	for (const [name, makeW] of [
		['default weights', () => [...DEFAULT_W]],
		['perturbed weights', (rand: () => number) => perturbed(rand)]
	] as const) {
		it(`matches ts-fsrs on random histories (${name})`, () => {
			const rand = mulberry32(42);
			for (let c = 0; c < 200; c++) {
				const w = makeW(rand);
				const h = randomHistory(rand);
				const own = replay(numberNum, w, stepsOf(h));
				const ref = reference(w, h);
				expect(Math.abs(own.s - ref.s) / ref.s).toBeLessThan(1e-6);
				expect(Math.abs(own.d - ref.d) / ref.d).toBeLessThan(1e-6);
			}
		});
	}

	it('retrievability equals forgetting_curve', () => {
		const rand = mulberry32(3);
		for (let i = 0; i < 200; i++) {
			const w = perturbed(rand);
			const t = Math.floor(rand() * 60);
			const s = 0.5 + rand() * 200;
			const own = retrievability(numberNum, w, t, s);
			expect(Math.abs(own - forgetting_curve(w, t, s))).toBeLessThan(1e-8);
		}
		expect(retrievability(numberNum, [...default_w], 0, 5)).toBe(1);
	});
});

describe('replay', () => {
	it('labels only steps after the first with t >= 1, before updating', () => {
		const seen: Array<[number, number]> = [];
		replay(
			numberNum,
			[...DEFAULT_W],
			[
				{ t: 0, g: 3 },
				{ t: 0, g: 3 },
				{ t: 3, g: 1 },
				{ t: 5, g: 4 }
			],
			(r, y, index) => seen.push([y, index])
		);
		expect(seen.map(([y]) => y)).toEqual([0, 1]);
		expect(seen.map(([, i]) => i)).toEqual([2, 3]);
	});

	it('a single review gives the initial state', () => {
		const { s, d } = replay(numberNum, [...DEFAULT_W], [{ t: 0, g: 3 }]);
		expect(s).toBeCloseTo(DEFAULT_W[2], 12);
		expect(d).toBeCloseTo(DEFAULT_W[4] - Math.exp(2 * DEFAULT_W[5]) + 1, 12);
	});
});

describe('daysBetween', () => {
	it('counts UTC calendar days', () => {
		expect(daysBetween('2026-01-01T23:59:00Z', '2026-01-02T00:01:00Z')).toBe(1);
		expect(daysBetween('2026-01-01T00:01:00Z', '2026-01-01T23:59:00Z')).toBe(0);
		expect(daysBetween('2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z')).toBe(0);
	});
});
