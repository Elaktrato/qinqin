import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/strokes.json';
import { matchStroke } from './matcher';
import { MATCH } from './params';
import type { Pt } from './strokes';

type Expect = { kind: string; strokes?: number[]; reason?: string };
const chars = fixtures.chars as Record<string, Pt[][]>;
const cases = fixtures.cases as { name: string; char: string; next: number; ink: Pt[]; expect: Expect }[];

// Cases the starting thresholds wrongly accept (reported, not tuned away; see Task 6 / owner feel check).
// `it.fails` keeps them visible: remove an entry once the matcher rejects the case.
const KNOWN_ACCEPTED = new Set([
	'了 #0 next-but-one drawn',
	'子 #0 next-but-one drawn',
	'糸 #0 next-but-one drawn',
	'糸 #1 scribble',
	'纟 #0 next-but-one drawn',
	'红 #0 next-but-one drawn',
	'红 #4 next-but-one drawn',
	'口 #1 next-but-one drawn',
	'永 #1 next-but-one drawn',
	'永 #1 scribble',
	'永 #3 next-but-one drawn',
	'我 #0 next-but-one drawn',
	'好 #0 next-but-one drawn',
	'好 #3 next-but-one drawn'
]);

describe('MATCH', () => {
	it('holds the spec starting values', () => {
		expect(MATCH).toEqual({
			resample: 32, maxOffset: 0.3, minScale: 0.5, maxScale: 2.0, minCos: 0.5,
			maxShape: 0.2, maxGap: 0.2, maxJoin: 3, minInk: 0.02
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
		if (KNOWN_ACCEPTED.has(name)) it.fails(name, run);
		else it(name, run);
	}
});
