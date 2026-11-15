import { CLAMP_PARAMETERS } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';

import type { Dataset } from './dataset';
import { evaluate } from './evaluate';
import { optimize } from './optimize';
import { DEFAULT_W } from './params';
import { canApply } from './preview';
import { simulate } from './synthetic';

function trueWeights(): number[] {
	const w = [...DEFAULT_W];
	const ranges = CLAMP_PARAMETERS(2, true);
	const factors: Record<number, number> = { 8: 1.3, 9: 0.7, 10: 1.3, 11: 0.7 };
	for (const [i, f] of Object.entries(factors)) {
		const k = Number(i);
		w[k] = Math.min(Math.max(w[k] * f, ranges[k][0]), ranges[k][1]);
	}
	return w;
}

describe('simulate', () => {
	it('is deterministic and counts labelled items', () => {
		const a = simulate({ w: DEFAULT_W, cards: 50, days: 200, seed: 3 });
		const b = simulate({ w: DEFAULT_W, cards: 50, days: 200, seed: 3 });
		expect(a).toEqual(b);
		expect(a.cards).toHaveLength(50);
		let n = 0;
		for (const c of a.cards) for (const s of c.steps.slice(1)) if (s.t >= 1) n++;
		expect(a.labelled).toBe(n);
		expect(n).toBeGreaterThan(100);
	});
});

describe('optimize', () => {
	it('refuses fewer than 400 labelled items', () => {
		const data: Dataset = { cards: [], labelled: 399 };
		expect(optimize(data)).toEqual({ ok: false, reason: 'too-few', labelled: 399, needed: 1 });
	});

	it('beats the defaults and comes within 2% of the true fit', () => {
		const wTrue = trueWeights();
		const data = simulate({ w: wTrue, cards: 600, days: 365, seed: 7 });
		const result = optimize(data);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const base = evaluate(DEFAULT_W, data).logLoss;
		const best = evaluate(wTrue, data).logLoss;
		expect(result.logLoss).toBeLessThan(base);
		expect(result.logLoss).toBeLessThanOrEqual(best * 1.02);
		expect(result.logLoss).toBeCloseTo(evaluate(result.w, data).logLoss, 12);
		const ranges = CLAMP_PARAMETERS(2, true);
		result.w.forEach((x, i) => {
			expect(x).toBeGreaterThanOrEqual(ranges[i][0]);
			expect(x).toBeLessThanOrEqual(ranges[i][1]);
		});
		const again = optimize(data);
		expect(again.ok && again.w).toEqual(result.w);
	});

	it.each([
		[600, 1],
		[600, 2],
		[600, 7],
		[600, 9],
		[2000, 7]
	])('fits within 2%% of the true fit (%i cards, seed %i)', (cards, seed) => {
		const wTrue = trueWeights();
		const data = simulate({ w: wTrue, cards, days: 365, seed });
		const result = optimize(data);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.logLoss).toBeLessThan(evaluate(DEFAULT_W, data).logLoss);
		expect(result.logLoss).toBeLessThanOrEqual(evaluate(wTrue, data).logLoss * 1.02);
	});

	it('stops when asked', () => {
		const data = simulate({ w: DEFAULT_W, cards: 300, days: 365, seed: 2 });
		let calls = 0;
		const result = optimize(data, {
			shouldStop: () => ++calls > 1
		});
		expect(result).toMatchObject({ ok: false, reason: 'stopped' });
	});

	it('reports progress up to the total', () => {
		const data = simulate({ w: DEFAULT_W, cards: 300, days: 365, seed: 2 });
		const seen: [number, number][] = [];
		optimize(data, { onProgress: (d, t) => seen.push([d, t]) });
		expect(seen.length).toBeGreaterThan(1);
		expect(seen[seen.length - 1][0]).toBe(seen[seen.length - 1][1]);
	});

	it('flags low data and finishes 3,000 items in time', () => {
		let data = simulate({ w: DEFAULT_W, cards: 150, days: 365, seed: 11 });
		for (let cards = 200; data.labelled < 3000; cards += 50) {
			data = simulate({ w: DEFAULT_W, cards, days: 365, seed: 11 });
		}
		const started = performance.now();
		const result = optimize(data);
		const ms = performance.now() - started;
		console.info(`optimize: ${data.labelled} labelled items in ${Math.round(ms)} ms`);
		expect(ms).toBeLessThan(20_000);
		expect(result.ok && result.lowData).toBe(false);

		const small = simulate({ w: DEFAULT_W, cards: 100, days: 365, seed: 5 });
		expect(small.labelled).toBeGreaterThanOrEqual(400);
		expect(small.labelled).toBeLessThan(1000);
		const low = optimize(small);
		expect(low.ok && low.lowData).toBe(true);
	});

	describe('small logs', () => {
		const wTrue = (() => {
			const w = [...DEFAULT_W];
			w[8] = 1.4;
			w[10] = 1.2;
			w[11] = 1.0;
			return w;
		})();

		it.each([3, 4, 5, 6, 7])('seed %i: ordered initial stabilities, none at the range edge', (seed) => {
			const train = simulate({ w: wTrue, cards: 90, days: 200, seed });
			const r = optimize(train);
			if (!r.ok) return;
			const s0 = r.w.slice(0, 4);
			expect(s0[0]).toBeLessThanOrEqual(s0[1]);
			expect(s0[1]).toBeLessThanOrEqual(s0[2]);
			expect(s0[2]).toBeLessThanOrEqual(s0[3]);
			for (const x of s0) {
				expect(x).toBeGreaterThan(0.11);
				expect(x).toBeLessThan(99);
			}
		});

		it.each([3, 4, 5, 6, 7])('seed %i: an applicable fit is not worse on new reviews', (seed) => {
			const train = simulate({ w: wTrue, cards: 90, days: 200, seed });
			const test = simulate({ w: wTrue, cards: 3000, days: 200, seed: seed + 100 });
			const r = optimize(train);
			if (!r.ok) return;
			expect(r.heldOut).not.toBeNull();
			const check = canApply({
				candidate: r,
				activeLogLoss: evaluate(DEFAULT_W, train).logLoss,
				startedWorkspace: 1,
				currentWorkspace: 1,
				source: 'optimized'
			});
			const held = evaluate(r.w, test).logLoss;
			const base = evaluate(DEFAULT_W, test).logLoss;
			console.info(
				`seed ${seed}: ${train.labelled} labelled, new-data loss ${held.toFixed(4)} vs defaults ${base.toFixed(4)}, apply ${check.ok}`
			);
			if (check.ok) expect(held).toBeLessThanOrEqual(base + 0.003);
		});

		it('still offers a fit that is clearly better on a small log', () => {
			const strong = [...DEFAULT_W];
			strong[8] = 0.8;
			strong[9] = 0.5;
			strong[10] = 2.2;
			strong[11] = 0.5;
			strong[14] = 0.5;
			const train = simulate({ w: strong, cards: 150, days: 250, seed: 4 });
			const test = simulate({ w: strong, cards: 3000, days: 250, seed: 104 });
			const r = optimize(train);
			expect(r.ok).toBe(true);
			if (!r.ok) return;
			expect(r.heldOut?.small).toBe(true);
			const check = canApply({
				candidate: r,
				activeLogLoss: evaluate(DEFAULT_W, train).logLoss,
				startedWorkspace: 1,
				currentWorkspace: 1,
				source: 'optimized'
			});
			expect(check).toEqual({ ok: true });
			expect(evaluate(r.w, test).logLoss).toBeLessThan(evaluate(DEFAULT_W, test).logLoss);
		});
	});
});
