// A scalar reverse-mode autodiff tape. Every operation appends one node
// (value, up to two parents, the local derivative towards each); backward
// sweeps the nodes once in reverse. Flat typed arrays keep a training
// batch of a few hundred thousand nodes cheap; reset() reuses them.

import type { Num } from './model';

declare const varBrand: unique symbol;
/** A node of the tape: an opaque index. */
export type Var = number & { readonly [varBrand]: true };

const INITIAL = 1 << 12;

export class Tape {
	private n = 0;
	private cap = INITIAL;
	private val: Float64Array<ArrayBuffer> = new Float64Array(INITIAL);
	private adj: Float64Array<ArrayBuffer> = new Float64Array(INITIAL);
	private d1: Float64Array<ArrayBuffer> = new Float64Array(INITIAL);
	private d2: Float64Array<ArrayBuffer> = new Float64Array(INITIAL);
	private p1: Int32Array<ArrayBuffer> = new Int32Array(INITIAL);
	private p2: Int32Array<ArrayBuffer> = new Int32Array(INITIAL);

	private grow(): void {
		const cap = this.cap * 2;
		const f = (old: Float64Array<ArrayBuffer>): Float64Array<ArrayBuffer> => {
			const next = new Float64Array(cap);
			next.set(old);
			return next;
		};
		const g = (old: Int32Array<ArrayBuffer>): Int32Array<ArrayBuffer> => {
			const next = new Int32Array(cap);
			next.set(old);
			return next;
		};
		this.val = f(this.val);
		this.adj = f(this.adj);
		this.d1 = f(this.d1);
		this.d2 = f(this.d2);
		this.p1 = g(this.p1);
		this.p2 = g(this.p2);
		this.cap = cap;
	}

	/** push appends a node and returns it. */
	push(value: number, p1: number, d1: number, p2: number, d2: number): Var {
		if (this.n === this.cap) this.grow();
		const i = this.n++;
		this.val[i] = value;
		this.adj[i] = 0;
		this.p1[i] = p1;
		this.d1[i] = d1;
		this.p2[i] = p2;
		this.d2[i] = d2;
		return i as Var;
	}

	/** variable adds a leaf whose gradient can be read after backward. */
	variable(x: number): Var {
		return this.push(x, -1, 0, -1, 0);
	}

	value(v: Var): number {
		return this.val[v];
	}

	grad(v: Var): number {
		return this.adj[v];
	}

	/** backward fills every adjoint with d(out)/d(node). */
	backward(out: Var): void {
		this.adj.fill(0, 0, this.n);
		this.adj[out] = 1;
		for (let i = out; i >= 0; i--) {
			const a = this.adj[i];
			if (a === 0) continue;
			const p1 = this.p1[i];
			if (p1 >= 0) this.adj[p1] += a * this.d1[i];
			const p2 = this.p2[i];
			if (p2 >= 0) this.adj[p2] += a * this.d2[i];
		}
	}

	/** reset empties the tape and keeps its storage. */
	reset(): void {
		this.n = 0;
	}
}

/** tapeNum is the Num<Var> that records onto `tape`. */
export function tapeNum(tape: Tape): Num<Var> {
	const v = (x: Var) => tape.value(x);
	return {
		c: (x) => tape.push(x, -1, 0, -1, 0),
		add: (a, b) => tape.push(v(a) + v(b), a, 1, b, 1),
		sub: (a, b) => tape.push(v(a) - v(b), a, 1, b, -1),
		mul: (a, b) => tape.push(v(a) * v(b), a, v(b), b, v(a)),
		div: (a, b) => {
			const y = v(b);
			return tape.push(v(a) / y, a, 1 / y, b, -v(a) / (y * y));
		},
		pow: (a, b) => {
			const x = v(a);
			const y = v(b);
			const out = Math.pow(x, y);
			return tape.push(out, a, y * Math.pow(x, y - 1), b, x > 0 ? out * Math.log(x) : 0);
		},
		exp: (a) => {
			const out = Math.exp(v(a));
			return tape.push(out, a, out, -1, 0);
		},
		log: (a) => tape.push(Math.log(v(a)), a, 1 / v(a), -1, 0),
		min: (a, b) => (v(a) <= v(b) ? tape.push(v(a), a, 1, -1, 0) : tape.push(v(b), b, 1, -1, 0)),
		max: (a, b) => (v(a) >= v(b) ? tape.push(v(a), a, 1, -1, 0) : tape.push(v(b), b, 1, -1, 0)),
		value: v
	};
}
