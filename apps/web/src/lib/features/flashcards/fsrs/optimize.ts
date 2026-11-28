// Fits the FSRS-6 weights to a review history: pretrain the four initial
// stabilities, then Adam on the other seventeen weights against the
// binary cross-entropy of the predicted recall plus a pull towards the
// defaults. Deterministic for one engine: fixed seed, cards ordered before
// shuffling (the stored result is what syncs, nothing is recomputed on
// another device).
//
// Gate protocol: the log is split by time. The candidate is first fitted
// on the earlier 80 % of the labelled items and compared with the current
// weights on the most recent 20 %, which that fit never saw (`heldOut`);
// then the final candidate is fitted on all the data. canApply (preview.ts)
// uses both: a small log is judged on the held-out tail, a large one on
// the in-sample fit and must not be worse on the tail.

import { CLAMP_PARAMETERS } from 'ts-fsrs';

import type { Dataset } from './dataset';
import { evaluate } from './evaluate';
import { numberNum, replay, retrievability, type Step } from './model';
import { DEFAULT_W } from '$lib/studycore/fsrsParams';
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
const PRETRAIN_MIN_CARDS = 15;
/** Pseudo-cards of default behaviour each initial stability is pulled towards. */
const PRETRAIN_PRIOR = 16;
/** Below this many labelled items the held-out numbers are the headline. */
export const SMALL_LOG = 2000;
const HOLDOUT_FRACTION = 0.2;
const HOLDOUT_MIN_ITEMS = 40;
const HEAD_MIN_ITEMS = 200;
const S0_RANGE: [number, number] = [0.1, 100];
const BETA1 = 0.9;
const BETA2 = 0.999;
const ADAM_EPS = 1e-8;
const P_EPS = 1e-6;

/** The candidate fitted on the earlier reviews, scored on the latest ones. */
export interface HeldOut {
	/** Labelled items in the held-out tail. */
	items: number;
	/** Log loss of the head-fitted candidate on the tail. */
	candidate: number;
	/** Log loss of the current weights on the same tail. */
	current: number;
	/** Mean per-item log loss saved by the candidate (current minus candidate). */
	gain: number;
	/** Standard error of `gain` over the held-out items. */
	se: number;
	/** The log is small: the held-out numbers are the ones to show. */
	small: boolean;
}

export type OptimizeResult =
	| {
			ok: true;
			w: number[];
			logLoss: number;
			rmseBins: number;
			labelled: number;
			lowData: boolean;
			heldOut: HeldOut | null;
	  }
	| { ok: false; reason: 'too-few' | 'stopped'; labelled: number; needed?: number };

export interface OptimizeOptions {
	/** The weights the candidate is compared with; the defaults when omitted. */
	current?: readonly number[];
	onProgress?: (done: number, total: number) => void;
	shouldStop?: () => boolean;
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

/**
 * pretrain fits w0..w3 from each first grade's second reviews. Each fit
 * is pulled towards the default in log space by PRETRAIN_PRIOR
 * pseudo-cards (so a handful of cards cannot push it to the range edge),
 * then the four are made non-decreasing by pooling neighbours.
 */
function pretrain(data: Dataset, w: number[]): void {
	const ranges = CLAMP_PARAMETERS(2, true);
	const weight = [1, 1, 1, 1];
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
		const fitted = goldenSection(loss, S0_RANGE[0], S0_RANGE[1]);
		const n = seconds.length;
		const smooth = Math.exp(
			(n * Math.log(fitted) + PRETRAIN_PRIOR * Math.log(DEFAULT_W[g - 1])) / (n + PRETRAIN_PRIOR)
		);
		w[g - 1] = smooth;
		weight[g - 1] = n + PRETRAIN_PRIOR;
	}
	// Pool adjacent violators on log stability so w0 <= w1 <= w2 <= w3.
	const blocks: { log: number; weight: number; count: number }[] = [];
	for (let i = 0; i < 4; i++) {
		blocks.push({ log: Math.log(w[i]), weight: weight[i], count: 1 });
		while (blocks.length > 1 && blocks[blocks.length - 2].log > blocks[blocks.length - 1].log) {
			const b = blocks.pop()!;
			const a = blocks.pop()!;
			const total = a.weight + b.weight;
			blocks.push({
				log: (a.log * a.weight + b.log * b.weight) / total,
				weight: total,
				count: a.count + b.count
			});
		}
	}
	let at = 0;
	for (const block of blocks) {
		for (let k = 0; k < block.count; k++, at++) {
			w[at] = Math.min(Math.max(Math.exp(block.log), ranges[at][0]), ranges[at][1]);
		}
	}
}

/** itemLosses lists the per-item log loss of `w` over the items on or after `sinceDay`. */
function itemLosses(w: readonly number[], data: Dataset, sinceDay: number): number[] {
	const out: number[] = [];
	const weights = [...w];
	for (const card of data.cards) {
		replay(numberNum, weights, card.steps, (r, y, index) => {
			if ((card.days?.[index] ?? -Infinity) < sinceDay) return;
			const p = Math.min(Math.max(r, P_EPS), 1 - P_EPS);
			out.push(-(y === 1 ? Math.log(p) : Math.log(1 - p)));
		});
	}
	return out;
}

/** pairedGain is the mean of a - b over the items, with its standard error. */
function pairedGain(a: number[], b: number[]): { gain: number; se: number } {
	const n = a.length;
	let mean = 0;
	for (let i = 0; i < n; i++) mean += a[i] - b[i];
	mean /= n;
	let ss = 0;
	for (let i = 0; i < n; i++) ss += (a[i] - b[i] - mean) ** 2;
	return { gain: mean, se: Math.sqrt(ss / Math.max(1, n - 1) / n) };
}

function labelledOf(steps: readonly Step[]): number {
	let n = 0;
	for (let i = 1; i < steps.length; i++) if (steps[i].t >= 1) n++;
	return n;
}

/**
 * fit trains the weights on `data`. `onBatch(fraction)` runs after every
 * batch; it returns true to stop, and fit then returns null.
 */
function fit(data: Dataset, onBatch: (fraction: number) => boolean): number[] | null {
	const labelled = data.labelled;
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
			if (onBatch(done / total)) return null;
		}
	}
	return w;
}

/**
 * splitByTime cuts the log at the UTC day where the latest 20 % of the
 * labelled items begin. `head` keeps every review before that day.
 */
function splitByTime(data: Dataset): { head: Dataset; sinceDay: number; tail: number } | null {
	const days: number[] = [];
	for (const card of data.cards) {
		if (card.days === undefined || card.days.length !== card.steps.length) return null;
		for (let i = 1; i < card.steps.length; i++) if (card.steps[i].t >= 1) days.push(card.days[i]);
	}
	if (days.length === 0) return null;
	days.sort((a, b) => a - b);
	const sinceDay = days[Math.floor(days.length * (1 - HOLDOUT_FRACTION))];
	const tail = days.filter((d) => d >= sinceDay).length;
	const cards: Dataset['cards'] = [];
	let labelled = 0;
	for (const card of data.cards) {
		const keep = card.days!.filter((d) => d < sinceDay).length;
		if (keep === 0) continue;
		const steps = card.steps.slice(0, keep);
		cards.push({ cardId: card.cardId, steps, days: card.days!.slice(0, keep) });
		labelled += labelledOf(steps);
	}
	if (tail < HOLDOUT_MIN_ITEMS || labelled < HEAD_MIN_ITEMS) return null;
	return { head: { cards, labelled }, sinceDay, tail };
}

export function optimize(data: Dataset, opts: OptimizeOptions = {}): OptimizeResult {
	const labelled = data.labelled;
	if (labelled < MIN_LABELLED) {
		return { ok: false, reason: 'too-few', labelled, needed: MIN_LABELLED - labelled };
	}
	const current = opts.current ?? DEFAULT_W;
	const split = splitByTime(data);
	// Two fits when a held-out tail exists: 0..0.4 earlier reviews, 0.4..1 all.
	const SCALE = 1000;
	const report = (fraction: number): boolean => {
		opts.onProgress?.(Math.round(fraction * SCALE), SCALE);
		return opts.shouldStop?.() === true;
	};

	let heldOut: HeldOut | null = null;
	if (split !== null) {
		const headW = fit(split.head, (f) => report(f * 0.4));
		if (headW === null) return { ok: false, reason: 'stopped', labelled };
		const mine = itemLosses(headW, data, split.sinceDay);
		const theirs = itemLosses(current, data, split.sinceDay);
		const { gain, se } = pairedGain(theirs, mine);
		heldOut = {
			items: split.tail,
			candidate: mine.reduce((x, y) => x + y, 0) / mine.length,
			current: theirs.reduce((x, y) => x + y, 0) / theirs.length,
			gain,
			se,
			small: labelled < SMALL_LOG
		};
	}
	const base = split === null ? 0 : 0.4;
	const w = fit(data, (f) => report(base + f * (1 - base)));
	if (w === null) return { ok: false, reason: 'stopped', labelled };
	opts.onProgress?.(SCALE, SCALE);
	const final = evaluate(w, data);
	return {
		ok: true,
		w,
		logLoss: final.logLoss,
		rmseBins: final.rmseBins,
		labelled,
		lowData: labelled < LOW_DATA_LABELLED,
		heldOut
	};
}
