import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
	DEFAULT_W,
	checkWeights,
	formatWeights,
	parseWeightString,
	resolveState,
	validWeights,
	weightsKey,
	type ParamSet
} from './params';

// Read with JSON.parse, not imported: a JSON import turns 1e999 (Infinity) into null.
const fsrsFixture: unknown = JSON.parse(
	readFileSync(resolve(__dirname, '../../../../../../docs/contracts/scheduler/fsrs.json'), 'utf8')
);

function set(id: string, createdAt: string, w: readonly number[] = DEFAULT_W): ParamSet {
	return { id, w: [...w], createdAt, source: 'optimized' };
}

function withIndex(index: number, value: number): number[] {
	const w = [...DEFAULT_W];
	w[index] = value;
	return w;
}

describe('validWeights', () => {
	it('keeps the defaults', () => {
		expect(validWeights(DEFAULT_W)).toEqual([...DEFAULT_W]);
	});

	it('migrates 19 numbers to 21', () => {
		expect(validWeights(DEFAULT_W.slice(0, 19))).toHaveLength(21);
	});

	it('migrates 17 numbers to 21', () => {
		expect(validWeights(DEFAULT_W.slice(0, 17))).toHaveLength(21);
	});

	it('rejects NaN, a wrong length and an out-of-range value', () => {
		expect(validWeights(withIndex(3, NaN))).toBeNull();
		expect(validWeights([...DEFAULT_W, 1])).toBeNull();
		expect(validWeights(withIndex(4, 11))).toBeNull();
		expect(validWeights('nope')).toBeNull();
		expect(validWeights(null)).toBeNull();
		expect(validWeights([...DEFAULT_W].map(String))).toBeNull();
	});
});

describe('checkWeights', () => {
	it('names the first bad weight, 1-based, without clipping', () => {
		expect(checkWeights(withIndex(5, 9))).toEqual({
			ok: false,
			error: 'Weight 6 is outside 0.001–4.'
		});
	});

	it('reports a length error', () => {
		expect(checkWeights(DEFAULT_W.slice(0, 18))).toEqual({
			ok: false,
			error: 'Expected 17, 19 or 21 numbers, got 18.'
		});
	});
});

describe('parseWeightString', () => {
	const numbers = [...DEFAULT_W].map(String);

	it.each([
		['comma separated', numbers.join(', ')],
		['brackets', `[${numbers.join(',')}]`],
		['newlines', numbers.join('\n')],
		['trailing comma', `${numbers.join(', ')},`],
		['padding', `  ${numbers.join('  ,  ')}  `]
	])('accepts %s', (_name, text) => {
		expect(parseWeightString(text)).toEqual({ ok: true, w: [...DEFAULT_W] });
	});

	it('accepts 19 and 17 numbers, migrated to 21', () => {
		for (const n of [19, 17]) {
			const r = parseWeightString(numbers.slice(0, n).join(', '));
			expect(r.ok && r.w.length).toBe(21);
		}
	});

	it('keeps a migrated import valid, so it can be stored and read back', () => {
		for (const n of [19, 17]) {
			const r = parseWeightString(numbers.slice(0, n).join(', '));
			expect(r.ok).toBe(true);
			if (!r.ok) continue;
			expect(validWeights(r.w)).toEqual(r.w);
		}
	});

	it('round-trips 17, 19 and 21 numbers through a stored set', () => {
		const w17 = '0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61';
		const w19 = numbers.slice(0, 19).join(', ');
		const w21 = formatWeights(DEFAULT_W);
		for (const text of [w17, w19, w21]) {
			const r = parseWeightString(text);
			expect(r.ok, text).toBe(true);
			if (!r.ok) continue;
			expect(r.w).toHaveLength(21);
			const stored = validWeights(JSON.parse(JSON.stringify(r.w)));
			expect(stored).toEqual(r.w);
			const set: ParamSet | null = stored === null ? null : { id: 'X', w: stored, createdAt: 'c', source: 'imported' };
			expect(resolveState(set ? [set] : [], { setId: 'X' }).w).toEqual(r.w);
		}
	});

	it('keeps the typed numbers of a 19-number import exactly', () => {
		const r = parseWeightString(numbers.slice(0, 19).join(', '));
		expect(r.ok && r.w.slice(0, 19)).toEqual(numbers.slice(0, 19).map(Number));
	});

	it('rejects a 17-number import whose converted weights leave the allowed range', () => {
		const base = '0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61'.split(', ').map(Number);
		const high4 = [...base];
		high4[4] = 9;
		high4[5] = 1;
		const r1 = parseWeightString(high4.join(', '));
		expect(r1.ok).toBe(false);
		expect(!r1.ok && r1.error).toMatch(/^Weight 5 is outside 1.10 after converting from 17 numbers/);
		const high6 = [...base];
		high6[6] = 3.8;
		const r2 = parseWeightString(high6.join(', '));
		expect(r2.ok).toBe(false);
		expect(!r2.ok && r2.error).toMatch(/^Weight 7 is outside .* after converting from 17 numbers/);
	});

	it('rejects a non-number', () => {
		expect(parseWeightString('abc')).toEqual({ ok: false, error: 'Not a list of numbers.' });
		expect(parseWeightString('')).toEqual({ ok: false, error: 'Not a list of numbers.' });
		expect(parseWeightString(`${numbers.slice(0, 20).join(',')}, x`)).toEqual({
			ok: false,
			error: 'Not a list of numbers.'
		});
	});

	it('rejects a wrong count', () => {
		expect(parseWeightString(numbers.slice(0, 18).join(', '))).toEqual({
			ok: false,
			error: 'Expected 17, 19 or 21 numbers, got 18.'
		});
	});

	it('rejects an out-of-range weight instead of clipping it', () => {
		expect(parseWeightString(withIndex(5, 9).join(', '))).toEqual({
			ok: false,
			error: 'Weight 6 is outside 0.001–4.'
		});
	});

	it('round-trips formatWeights(DEFAULT_W)', () => {
		expect(parseWeightString(formatWeights(DEFAULT_W))).toEqual({ ok: true, w: [...DEFAULT_W] });
	});
});

describe('formatWeights and weightsKey', () => {
	it('uses four decimals and comma-space', () => {
		expect(formatWeights([1, 0.5])).toBe('1.0000, 0.5000');
	});

	it('keys equal arrays equally', () => {
		expect(weightsKey(DEFAULT_W)).toBe(weightsKey([...DEFAULT_W]));
		expect(weightsKey(DEFAULT_W)).not.toBe(weightsKey(withIndex(8, 2)));
	});
});

describe('resolveState', () => {
	const a = set('A', '2026-01-01T00:00:00Z', withIndex(8, 1.5));
	const b = set('B', '2026-02-01T00:00:00Z', withIndex(8, 2.5));

	it('sorts newest first and follows a valid pointer', () => {
		const state = resolveState([a, b], { setId: 'A', changedAt: 'x' });
		expect(state.sets.map((s) => s.id)).toEqual(['B', 'A']);
		expect(state.active?.id).toBe('A');
		expect(state.w).toEqual(a.w);
	});

	it('remembers the pointer even when its set cannot be read', () => {
		expect(resolveState([a, b], { setId: 'Z' }).pointer).toBe('Z');
		expect(resolveState([a, b], { setId: 'A' }).pointer).toBe('A');
		expect(resolveState([a, b], { setId: null }).pointer).toBeNull();
		expect(resolveState([a, b], undefined).pointer).toBeNull();
	});

	it('falls back to the defaults for a missing pointer, an unknown id or null', () => {
		for (const raw of [undefined, null, { setId: 'Z' }, { setId: null }, 'junk', { setId: 3 }]) {
			const state = resolveState([a, b], raw);
			expect(state.active).toBeNull();
			expect(state.w).toEqual(DEFAULT_W);
		}
	});
});

describe('docs/contracts/scheduler/fsrs.json: weights and the active set', () => {
	type Verdict = { ok: true; migrated: number[] } | { ok: false; reason: string; position?: number };
	const fixture = fsrsFixture as unknown as {
		rule: string;
		parameters: { w: number[] };
		weights: { name: string; w: unknown; expect: Verdict }[];
		paramSet: { name: string; key: string; raw: unknown; expect: ParamSet | null }[];
		resolve: {
			name: string;
			sets: ParamSet[];
			active: unknown;
			expect: { order: string[]; active: string | null; w: string; pointer: string | null };
		}[];
	};
	// checkWeights reports English messages; the fixture names the reason.
	function reasonOf(error: string): { reason: string; position?: number } {
		const at = /^Weight (\d+) /.exec(error);
		if (/not a finite number/.test(error)) return { reason: 'nonFinite', position: Number(at![1]) };
		if (/is outside/.test(error)) return { reason: 'range', position: Number(at![1]) };
		if (/^Expected 17, 19 or 21 numbers/.test(error)) return { reason: 'length' };
		if (error === 'Not a list of numbers.') return { reason: 'notNumbers' };
		return { reason: `unknown: ${error}` };
	}

	it('DEFAULT_W is the generator default_w', () => {
		expect(fixture.rule).toBe('scheduler/fsrs');
		expect([...DEFAULT_W]).toEqual(fixture.parameters.w);
	});
	for (const c of fixture.weights) {
		it(`weights: ${c.name}`, () => {
			const got = checkWeights(c.w);
			if (c.expect.ok) {
				expect(got).toEqual({ ok: true, w: c.w });
				expect(validWeights(c.w)).toEqual(c.expect.migrated);
			} else {
				expect(got.ok).toBe(false);
				if (!got.ok) expect(reasonOf(got.error)).toEqual({ reason: c.expect.reason, ...(c.expect.position ? { position: c.expect.position } : {}) });
				expect(validWeights(c.w)).toBeNull();
			}
		});
	}
	for (const c of fixture.resolve) {
		it(`resolve: ${c.name}`, () => {
			const state = resolveState(c.sets, c.active);
			expect(state.sets.map((s) => s.id)).toEqual(c.expect.order);
			expect(state.active?.id ?? null).toBe(c.expect.active);
			expect(state.w).toEqual(c.expect.w === 'default' ? fixture.parameters.w : c.sets.find((s) => s.id === c.expect.w)!.w);
			expect(state.pointer).toBe(c.expect.pointer);
		});
	}
});
