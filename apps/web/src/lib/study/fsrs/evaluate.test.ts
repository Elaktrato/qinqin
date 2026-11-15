import { describe, expect, it } from 'vitest';

import type { Dataset } from './dataset';
import { evaluate } from './evaluate';
import { retrievability, numberNum } from './model';
import { DEFAULT_W } from './params';

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

describe('evaluate', () => {
	it('logLoss of one item with R = 0.9, y = 1 is -ln 0.9', () => {
		const w = [...DEFAULT_W];
		w[2] = 3; // S after a first Good; R(3, 3) = 0.9
		const data: Dataset = {
			cards: [
				{
					cardId: 'a',
					steps: [
						{ t: 0, g: 3 },
						{ t: 3, g: 3 }
					]
				}
			],
			labelled: 1
		};
		expect(evaluate(w, data).logLoss).toBeCloseTo(-Math.log(0.9), 9);
	});

	it('is well calibrated on outcomes drawn from R', () => {
		const rand = mulberry32(5);
		const w = [...DEFAULT_W];
		const cards: Dataset['cards'] = [];
		for (let i = 0; i < 20000; i++) {
			const t = 1 + Math.floor(rand() * 12);
			const r = retrievability(numberNum, w, t, w[2]);
			cards.push({
				cardId: `c${i}`,
				steps: [
					{ t: 0, g: 3 },
					{ t, g: rand() < r ? 3 : 1 }
				]
			});
		}
		const result = evaluate(w, { cards, labelled: cards.length });
		expect(result.rmseBins).toBeLessThan(0.02);
		expect(result.logLoss).toBeGreaterThan(0);
	});

	it('detects a miscalibrated parameter set', () => {
		const rand = mulberry32(5);
		const w = [...DEFAULT_W];
		const cards: Dataset['cards'] = [];
		for (let i = 0; i < 5000; i++) {
			const t = 1 + Math.floor(rand() * 12);
			cards.push({
				cardId: `c${i}`,
				steps: [
					{ t: 0, g: 3 },
					{ t, g: rand() < 0.5 ? 3 : 1 }
				]
			});
		}
		expect(evaluate(w, { cards, labelled: cards.length }).rmseBins).toBeGreaterThan(0.05);
	});

	it('returns zeros without labelled items', () => {
		expect(evaluate(DEFAULT_W, { cards: [], labelled: 0 })).toEqual({ logLoss: 0, rmseBins: 0, items: 0 });
	});

	it('counts only items on or after sinceDay but replays the whole history', () => {
		const w = [...DEFAULT_W];
		const data: Dataset = {
			cards: [
				{
					cardId: 'a',
					steps: [
						{ t: 0, g: 3 },
						{ t: 3, g: 3 },
						{ t: 5, g: 1 }
					],
					days: [100, 103, 108]
				}
			],
			labelled: 2
		};
		const all = evaluate(w, data);
		const tail = evaluate(w, data, { sinceDay: 105 });
		const items = evaluate(w, { ...data, cards: [{ ...data.cards[0], steps: data.cards[0].steps.slice(0, 2), days: [100, 103] }] });
		expect(tail.items).toBe(1);
		expect(all.items).toBe(2);
		expect(tail.logLoss).not.toBeCloseTo(items.logLoss, 6);
	});
});
