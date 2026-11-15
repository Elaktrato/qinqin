// Fits the FSRS-6 weights to a review history: pretrain the four initial
// stabilities, then Adam on the other seventeen weights against the
// binary cross-entropy of the predicted recall plus a pull towards the
// defaults. Deterministic: fixed seed, cards ordered before shuffling.

import { CLAMP_PARAMETERS } from 'ts-fsrs';

import type { Dataset } from './dataset';
import { evaluate } from './evaluate';
import { numberNum, replay, retrievability, type Step } from './model';
import { DEFAULT_W } from './params';
import { mulberry32 } from './synthetic';
import { Tape, tapeNum, type Var } from './tape';

export const MIN_LABELLED = 400;
export const LOW_DATA_LABELLED = 1000;
const LR = 0.04;
const EPOCHS = 10;
// Ruling: schedule changed from 512 items x 5 epochs; see the plan.
const BATCH_ITEMS = 64;
const GAMMA = 1;
const SEED = 1;
const PRETRAIN_MIN_CARDS = 8;
const S0_RANGE: [number, number] = [0.1, 100];
const BETA1 = 0.9;
const BETA2 = 0.999;
const ADAM_EPS = 1e-8;
const P_EPS = 1e-6;

export type OptimizeResult =
	| {
			ok: true;
			w: number[];
			logLoss: number;
			rmseBins: number;
			labelled: number;
			lowData: boolean;
	  }
	| { ok: false; reason: 'too-few' | 'stopped'; labelled: number; needed?: number };

export interface OptimizeOptions {
	onProgress?: (done: number, total: number) => void;
	shouldStop?: () => boolean;
}

function labelledOf(steps: readonly Step[]): number {
	let n = 0;
	for (let i = 1; i < steps.length; i++) if (steps[i].t >= 1) n++;
	return n;
}

/** Golden-section minimum of a unimodal function on [lo, hi]. */
function goldenSection(f: (x: number) => number, lo: number, hi: number): number {
	const phi = (Math.sqrt(5) - 1) / 2;
	let a = lo;
	let b = hi;
	let c = b - phi * (b - a);
	let d = a + phi * (b - a);
	let fc = f(c);
	let fd = f(d);
	for (let i = 0; i < 40; i++) {
		if (fc < fd) {
			b = d;
			d = c;
			fd = fc;
			c = b - phi * (b - a);
			fc = f(c);
		} else {
			a = c;
			c = d;
			fc = fd;
			d = a + phi * (b - a);
			fd = f(d);
		}
	}
	return (a + b) / 2;
}

/** pretrain fits w0..w3 from each first grade's second reviews. */
function pretrain(data: Dataset, w: number[]): void {
	const ranges = CLAMP_PARAMETERS(2, true);
	for (let g = 1; g <= 4; g++) {
		const seconds = data.cards
			.filter((c) => c.steps[0].g === g && c.steps.length > 1 && c.steps[1].t >= 1)
			.map((c) => c.steps[1]);
		if (seconds.length < PRETRAIN_MIN_CARDS) continue;
		const loss = (s0: number): number => {
			let sum = 0;
			for (const step of seconds) {
				const r = retrievability(numberNum, w, step.t, s0);
				const p = Math.min(Math.max(r, P_EPS), 1 - P_EPS);
				sum -= step.g > 1 ? Math.log(p) : Math.log(1 - p);
			}
			return sum;
		};
		const s0 = goldenSection(loss, S0_RANGE[0], S0_RANGE[1]);
		w[g - 1] = Math.min(Math.max(s0, ranges[g - 1][0]), ranges[g - 1][1]);
	}
}

export function optimize(data: Dataset, opts: OptimizeOptions = {}): OptimizeResult {
	const labelled = data.labelled;
	if (labelled < MIN_LABELLED) {
		return { ok: false, reason: 'too-few', labelled, needed: MIN_LABELLED - labelled };
	}
	const ranges = CLAMP_PARAMETERS(2, true);
	const w = [...DEFAULT_W];
	pretrain(data, w);

	// The plan of every epoch up front, so progress has a fixed total.
	const rand = mulberry32(SEED);
	const cards = data.cards.filter((c) => labelledOf(c.steps) > 0);
	const plan: { steps: Step[] }[][][] = [];
	for (let e = 0; e < EPOCHS; e++) {
		const order = [...cards];
		for (let i = order.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[order[i], order[j]] = [order[j], order[i]];
		}
		const batches: { steps: Step[] }[][] = [];
		let batch: { steps: Step[] }[] = [];
		let items = 0;
		for (const card of order) {
			batch.push(card);
			items += labelledOf(card.steps);
			if (items >= BATCH_ITEMS) {
				batches.push(batch);
				batch = [];
				items = 0;
			}
		}
		if (batch.length > 0) batches.push(batch);
		plan.push(batches);
	}
	const total = plan.reduce((n, b) => n + b.length, 0);

	const tape = new Tape();
	const N = tapeNum(tape);
	const m = new Float64Array(21);
	const v = new Float64Array(21);
	let step = 0;
	let done = 0;
	for (const batches of plan) {
		for (const batch of batches) {
			tape.reset();
			const vars: Var[] = w.map((x) => tape.variable(x));
			let sum = N.c(0);
			let items = 0;
			const one = N.c(1);
			for (const card of batch) {
				replay(N, vars, card.steps, (r, y) => {
					const p = N.min(N.max(r, N.c(P_EPS)), N.c(1 - P_EPS));
					sum = N.sub(sum, N.log(y === 1 ? p : N.sub(one, p)));
					items++;
				});
			}
			if (items > 0) {
				let loss = N.div(sum, N.c(items));
				let reg = N.c(0);
				for (let i = 4; i < 21; i++) {
					const sigma = (ranges[i][1] - ranges[i][0]) / 4;
					const z = N.div(N.sub(vars[i], N.c(DEFAULT_W[i])), N.c(sigma));
					reg = N.add(reg, N.mul(z, z));
				}
				loss = N.add(loss, N.mul(N.c((GAMMA * items) / labelled), reg));
				tape.backward(loss);
				step++;
				for (let i = 4; i < 21; i++) {
					const g = tape.grad(vars[i]);
					m[i] = BETA1 * m[i] + (1 - BETA1) * g;
					v[i] = BETA2 * v[i] + (1 - BETA2) * g * g;
					const mh = m[i] / (1 - Math.pow(BETA1, step));
					const vh = v[i] / (1 - Math.pow(BETA2, step));
					const next = w[i] - (LR * mh) / (Math.sqrt(vh) + ADAM_EPS);
					w[i] = Math.min(Math.max(next, ranges[i][0]), ranges[i][1]);
				}
			}
			done++;
			opts.onProgress?.(done, total);
			if (opts.shouldStop?.() === true) {
				return { ok: false, reason: 'stopped', labelled };
			}
		}
	}
	const fit = evaluate(w, data);
	return {
		ok: true,
		w,
		logLoss: fit.logLoss,
		rmseBins: fit.rmseBins,
		labelled,
		lowData: labelled < LOW_DATA_LABELLED
	};
}
