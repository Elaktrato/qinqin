import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/strokes.json';
import { matchStroke } from './matcher';
import { MATCH } from './params';
import type { Pt } from './strokes';

type Expect = { kind: string; strokes?: number[]; reason?: string };
const chars = fixtures.chars as Record<string, Pt[][]>;
const cases = fixtures.cases as { name: string; char: string; next: number; ink: Pt[]; expect: Expect }[];

describe('MATCH', () => {
	it('holds the spec starting values', () => {
		expect(MATCH).toEqual({
			resample: 32, minInk: 0.02,
			minCos: 0.5, minChord: 0.25, minHalfCos: 0.3, maxShape: 0.24, shapeFloor: 0.18, shapeCap: 0.4, maxDev: 0.22,
			maxOffset: 0.3, minScale: 0.45, maxScale: 2.2,
			headMax: 0.12, headTurn: 35, tailMax: 0.25, inkTailMax: 0.5, tailTurn: 50, cutBody: 0.15, cutStraight: 30,
			minHook: 0.02, minHookShare: 0.04, minHookCos: 0.35, trimPenalty: 0.02,
			offsetWeight: 0.5, scaleWeight: 0.1, rankMargin: 0.03, maxGap: 0.2, maxJoin: 3
		});
	});
});

describe('matchStroke fixtures', () => {
	for (const { name, char, next, ink, expect: e } of cases) {
		const run = () => {
			const r = matchStroke(ink, chars[char], next);
			expect(r.kind).toBe(e.kind);
			if (e.strokes && r.kind === 'match') expect(r.strokes).toEqual(e.strokes);
			if (e.reason && r.kind === 'miss') expect(r.reason).toBe(e.reason);
		};
		it(name, run);
	}
});

describe('short strokes', () => {
	const line = [[{ x: 0.4, y: 0.5 }, { x: 0.5, y: 0.5 }]];
	it('accepts a short stroke whose end overshoots by a hand-sized amount', () => {
		const ink = [{ x: 0.4, y: 0.5 }, { x: 0.46, y: 0.5 }, { x: 0.5, y: 0.53 }];
		const r = matchStroke(ink, line, 0);
		expect(r.kind).toBe('match');
	});
	it('still rejects an endpoint far off even for a short stroke', () => {
		const ink = [{ x: 0.4, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.62 }];
		expect(matchStroke(ink, line, 0).kind).toBe('miss');
	});
});

// The owner's feel test on 好 (strokes numbered from 1 as a learner counts them).
describe('好 drawn the way a hand draws it', () => {
	const hao = chars['好'];
	const line = (...ps: [number, number][]) => ps.map(([x, y]) => ({ x, y }));
	it('stroke 2: a vague straight line down and slightly left', () => {
		expect(matchStroke(line([0.41, 0.36], [0.37, 0.55], [0.16, 0.77]), hao, 1)).toMatchObject({ kind: 'match', strokes: [1] });
		expect(matchStroke(line([0.4, 0.35], [0.14, 0.78]), hao, 1)).toMatchObject({ kind: 'match', strokes: [1] });
	});
	it('stroke 4: the corner of 子 in one motion, sharp or rounded', () => {
		expect(matchStroke(line([0.49, 0.24], [0.74, 0.21], [0.65, 0.35]), hao, 3)).toMatchObject({ kind: 'match', strokes: [3] });
		expect(matchStroke(line([0.49, 0.24], [0.68, 0.2], [0.73, 0.22], [0.72, 0.26], [0.65, 0.35]), hao, 3)).toMatchObject({
			kind: 'match',
			strokes: [3]
		});
	});
	it('stroke 5: the hook drawn as shown, left off, or exaggerated', () => {
		for (const ink of [
			line([0.62, 0.37], [0.68, 0.6], [0.67, 0.8], [0.55, 0.79]),
			line([0.62, 0.37], [0.68, 0.6], [0.67, 0.82]),
			line([0.62, 0.37], [0.68, 0.6], [0.67, 0.8], [0.47, 0.73]),
			line([0.62, 0.37], [0.68, 0.6], [0.66, 0.84], [0.43, 0.7])
		]) {
			expect(matchStroke(ink, hao, 4)).toMatchObject({ kind: 'match', strokes: [4] });
		}
	});
	it('clearly wrong strokes still miss', () => {
		// The last 横 drawn while the 竖钩 is expected (out of order).
		expect(matchStroke(line([0.44, 0.5], [0.94, 0.47]), hao, 4).kind).toBe('miss');
		// The 竖钩 drawn upwards.
		expect(matchStroke(line([0.55, 0.79], [0.67, 0.8], [0.62, 0.37]), hao, 4).kind).toBe('miss');
		// A 横 where the 撇 is expected.
		expect(matchStroke(line([0.15, 0.55], [0.42, 0.55]), hao, 1).kind).toBe('miss');
	});
});
