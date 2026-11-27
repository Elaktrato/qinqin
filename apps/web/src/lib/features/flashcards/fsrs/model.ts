// The FSRS-6 memory-state recursion, written once over an arithmetic
// interface: plain numbers evaluate and preview, tape variables give
// gradients. It follows ts-fsrs without its 8-decimal rounding (rounding
// has no gradient); a parity test pins the difference below 1e-6.

import { dateDiffInDays } from 'ts-fsrs';

export interface Num<T> {
	c(x: number): T;
	add(a: T, b: T): T;
	sub(a: T, b: T): T;
	mul(a: T, b: T): T;
	div(a: T, b: T): T;
	pow(a: T, b: T): T;
	exp(a: T): T;
	log(a: T): T;
	min(a: T, b: T): T;
	max(a: T, b: T): T;
	value(a: T): number;
}

export const numberNum: Num<number> = {
	c: (x) => x,
	add: (a, b) => a + b,
	sub: (a, b) => a - b,
	mul: (a, b) => a * b,
	div: (a, b) => a / b,
	pow: (a, b) => Math.pow(a, b),
	exp: (a) => Math.exp(a),
	log: (a) => Math.log(a),
	min: (a, b) => Math.min(a, b),
	max: (a, b) => Math.max(a, b),
	value: (a) => a
};

/** One review: `t` UTC days since the previous review (0 for the first). */
export interface Step {
	t: number;
	g: 1 | 2 | 3 | 4;
}

const S_MIN = 0.001;
const S_MAX = 36500;

/** daysBetween is ts-fsrs's dateDiffInDays on two RFC 3339 instants. */
export function daysBetween(a: string, b: string): number {
	return dateDiffInDays(new Date(a), new Date(b));
}

function clamp<T>(N: Num<T>, x: T, lo: number, hi: number): T {
	return N.min(N.max(x, N.c(lo)), N.c(hi));
}

/** retrievability is R(t, S) = (1 + f·t/S)^(−w20) with R(S, S) = 0.9. */
export function retrievability<T>(N: Num<T>, w: T[], t: number, s: T): T {
	const decay = N.sub(N.c(0), w[20]);
	const factor = N.sub(N.exp(N.div(N.c(Math.log(0.9)), decay)), N.c(1));
	const base = N.add(N.c(1), N.div(N.mul(factor, N.c(t)), s));
	return N.pow(base, decay);
}

/**
 * replay runs the recursion over one card's steps and returns the final
 * stability and difficulty. `onItem` sees every step after the first
 * with t >= 1 (a labelled item) before the state is updated: the
 * predicted recall, whether the grade was a pass, and the step index.
 */
export function replay<T>(
	N: Num<T>,
	w: T[],
	steps: readonly Step[],
	onItem?: (r: T, y: 0 | 1, index: number) => void
): { s: T; d: T } {
	const one = N.c(1);
	const first = steps[0];
	let s = N.max(w[first.g - 1], N.c(0.1));
	let d = clamp(
		N,
		N.add(N.sub(w[4], N.exp(N.mul(N.c(first.g - 1), w[5]))), one),
		1,
		10
	);
	// D0(4) inside the mean reversion is not clamped (ts-fsrs does not either).
	const d04 = N.add(N.sub(w[4], N.exp(N.mul(N.c(3), w[5]))), one);

	for (let i = 1; i < steps.length; i++) {
		const { t, g } = steps[i];
		const r = retrievability(N, w, t, s);
		if (t >= 1) onItem?.(r, g > 1 ? 1 : 0, i);

		let next: T;
		if (t === 0) {
			let k = N.mul(N.pow(s, N.sub(N.c(0), w[19])), N.exp(N.mul(w[17], N.add(N.c(g - 3), w[18]))));
			if (g >= 2) k = N.max(k, one);
			next = clamp(N, N.mul(s, k), S_MIN, S_MAX);
		} else if (g === 1) {
			const fail = clamp(
				N,
				N.mul(
					N.mul(
						N.mul(w[11], N.pow(d, N.sub(N.c(0), w[12]))),
						N.sub(N.pow(N.add(s, one), w[13]), one)
					),
					N.exp(N.mul(N.sub(one, r), w[14]))
				),
				S_MIN,
				S_MAX
			);
			const floor = N.max(N.div(s, N.exp(N.mul(w[17], w[18]))), N.c(S_MIN));
			next = N.min(floor, fail);
		} else {
			let gain = N.mul(
				N.mul(N.mul(N.exp(w[8]), N.sub(N.c(11), d)), N.pow(s, N.sub(N.c(0), w[9]))),
				N.sub(N.exp(N.mul(N.sub(one, r), w[10])), one)
			);
			if (g === 2) gain = N.mul(gain, w[15]);
			if (g === 4) gain = N.mul(gain, w[16]);
			next = clamp(N, N.mul(s, N.add(one, gain)), S_MIN, S_MAX);
		}

		const delta = N.mul(N.sub(N.c(0), w[6]), N.c(g - 3));
		const damped = N.add(d, N.div(N.mul(delta, N.sub(N.c(10), d)), N.c(9)));
		d = clamp(
			N,
			N.add(N.mul(w[7], d04), N.mul(N.sub(one, w[7]), damped)),
			1,
			10
		);
		s = next;
	}
	return { s, d };
}
