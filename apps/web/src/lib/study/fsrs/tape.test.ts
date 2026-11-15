import { describe, expect, it } from 'vitest';

import { numberNum, replay, type Num, type Step } from './model';
import { DEFAULT_W } from './params';
import { Tape, tapeNum, type Var } from './tape';

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

type Binary = <T>(N: Num<T>, a: T, b: T) => T;
type Unary = <T>(N: Num<T>, a: T) => T;

const binary: Record<string, Binary> = {
	add: (N, a, b) => N.add(a, b),
	sub: (N, a, b) => N.sub(a, b),
	mul: (N, a, b) => N.mul(a, b),
	div: (N, a, b) => N.div(a, b),
	pow: (N, a, b) => N.pow(a, b),
	min: (N, a, b) => N.min(a, b),
	max: (N, a, b) => N.max(a, b)
};

const unary: Record<string, Unary> = {
	exp: (N, a) => N.exp(a),
	log: (N, a) => N.log(a)
};

const H = 1e-6;

function close(actual: number, expected: number, rel: number): void {
	expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(Math.abs(expected), 1e-3));
}

describe('Tape gradients per operation', () => {
	it.each(Object.keys(binary))('%s matches central differences', (name) => {
		const rand = mulberry32(11);
		const f = binary[name];
		for (let i = 0; i < 50; i++) {
			const x = 0.5 + rand() * 2.5;
			const y = 0.5 + rand() * 2.5 + (name === 'min' || name === 'max' ? 0.1 : 0);
			const tape = new Tape();
			const N = tapeNum(tape);
			const a = tape.variable(x);
			const b = tape.variable(y);
			const out = f(N, a, b);
			tape.backward(out);
			expect(tape.value(out)).toBeCloseTo(f(numberNum, x, y), 12);
			const dx = (f(numberNum, x + H, y) - f(numberNum, x - H, y)) / (2 * H);
			const dy = (f(numberNum, x, y + H) - f(numberNum, x, y - H)) / (2 * H);
			close(tape.grad(a), dx, 1e-5);
			close(tape.grad(b), dy, 1e-5);
		}
	});

	it.each(Object.keys(unary))('%s matches central differences', (name) => {
		const rand = mulberry32(5);
		const f = unary[name];
		for (let i = 0; i < 50; i++) {
			const x = 0.5 + rand() * 2.5;
			const tape = new Tape();
			const a = tape.variable(x);
			const out = f(tapeNum(tape), a);
			tape.backward(out);
			close(tape.grad(a), (f(numberNum, x + H) - f(numberNum, x - H)) / (2 * H), 1e-5);
		}
	});

	it('min and max pass the gradient to the chosen operand only', () => {
		const tape = new Tape();
		const N = tapeNum(tape);
		const a = tape.variable(1);
		const b = tape.variable(2);
		tape.backward(N.min(a, b));
		expect([tape.grad(a), tape.grad(b)]).toEqual([1, 0]);
		tape.backward(N.max(a, b));
		expect([tape.grad(a), tape.grad(b)]).toEqual([0, 1]);
	});

	it('accumulates over reused variables', () => {
		const tape = new Tape();
		const N = tapeNum(tape);
		const a = tape.variable(3);
		tape.backward(N.add(N.mul(a, a), a));
		expect(tape.grad(a)).toBe(7);
	});
});

function randomSteps(rand: () => number): Step[] {
	const n = 3 + Math.floor(rand() * 8);
	const steps: Step[] = [{ t: 0, g: (1 + Math.floor(rand() * 4)) as Step['g'] }];
	for (let i = 1; i < n; i++) {
		steps.push({
			t: rand() < 0.15 ? 0 : 1 + Math.floor(rand() * 40),
			g: (1 + Math.floor(rand() * 4)) as Step['g']
		});
	}
	return steps;
}

function bce<T>(N: Num<T>, w: T[], cards: readonly Step[][]): T {
	let total = N.c(0);
	let count = 0;
	for (const steps of cards) {
		replay(N, w, steps, (r, y) => {
			const p = N.min(N.max(r, N.c(1e-6)), N.c(1 - 1e-6));
			const term = y === 1 ? N.log(p) : N.log(N.sub(N.c(1), p));
			total = N.sub(total, term);
			count++;
		});
	}
	return N.div(total, N.c(Math.max(count, 1)));
}

describe('Tape on the FSRS loss', () => {
	const rand = mulberry32(99);
	const cards = Array.from({ length: 20 }, () => randomSteps(rand));

	function lossAndGrad(tape: Tape, w: readonly number[]): { loss: number; grads: number[] } {
		const vars = w.map((x) => tape.variable(x));
		const out = bce(tapeNum(tape), vars, cards);
		tape.backward(out);
		return { loss: tape.value(out), grads: vars.map((v) => tape.grad(v)) };
	}

	it('matches finite differences on all 21 weights', () => {
		const tape = new Tape();
		const { loss, grads } = lossAndGrad(tape, DEFAULT_W);
		expect(loss).toBeCloseTo(bce(numberNum, [...DEFAULT_W], cards), 12);
		for (let i = 0; i < 21; i++) {
			const up = [...DEFAULT_W];
			const down = [...DEFAULT_W];
			up[i] += H;
			down[i] -= H;
			const fd = (bce(numberNum, up, cards) - bce(numberNum, down, cards)) / (2 * H);
			close(grads[i], fd, 1e-4);
		}
	});

	it('gives identical results after reset', () => {
		const tape = new Tape();
		const first = lossAndGrad(tape, DEFAULT_W);
		tape.reset();
		const second = lossAndGrad(tape, DEFAULT_W);
		expect(second).toEqual(first);
	});

	it('grows past its initial capacity', () => {
		const tape = new Tape();
		const N = tapeNum(tape);
		let acc: Var = tape.variable(1);
		for (let i = 0; i < 20000; i++) acc = N.add(acc, N.c(1));
		tape.backward(acc);
		expect(tape.value(acc)).toBe(20001);
	});
});
