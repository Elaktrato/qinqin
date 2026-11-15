// Synthetic review histories drawn from a known weight set, for tests and
// for generating throwaway data. Intervals follow the scheduler at 0.9
// retention (round(S), at least one day), recall is sampled from R.

import type { Dataset } from './dataset';
import { numberNum, replay, retrievability, type Step } from './model';

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface SimulateOptions {
	w: readonly number[];
	cards: number;
	days: number;
	seed: number;
}

function firstGrade(rand: () => number): 1 | 2 | 3 | 4 {
	const x = rand();
	if (x < 0.2) return 1;
	if (x < 0.35) return 2;
	if (x < 0.85) return 3;
	return 4;
}

export function simulate(opts: SimulateOptions): Dataset {
	const rand = mulberry32(opts.seed);
	const w = [...opts.w];
	const cards: Dataset['cards'] = [];
	let labelled = 0;
	for (let c = 0; c < opts.cards; c++) {
		let day = Math.floor(rand() * opts.days);
		const steps: Step[] = [{ t: 0, g: firstGrade(rand) }];
		for (;;) {
			const { s } = replay(numberNum, w, steps);
			const interval = Math.max(1, Math.round(s));
			day += interval;
			if (day >= opts.days) break;
			const r = retrievability(numberNum, w, interval, s);
			let g: 1 | 2 | 3 | 4 = 1;
			if (rand() < r) {
				const x = rand();
				g = x < 0.15 ? 2 : x < 0.9 ? 3 : 4;
			}
			steps.push({ t: interval, g });
			labelled++;
		}
		cards.push({ cardId: `c${String(c).padStart(5, '0')}`, steps });
	}
	return { cards, labelled };
}
