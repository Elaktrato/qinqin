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
			resample: 32, maxOffset: 0.3, minScale: 0.5, maxScale: 2.0, minCos: 0.5,
			maxShape: 0.2, maxEnd: 0.08, minEndTol: 0.04, laterRatio: 0.3, laterGain: 0.05, lookahead: 3, maxGap: 0.2, maxJoin: 3, minInk: 0.02
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

describe('endpoint tolerance floor', () => {
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
