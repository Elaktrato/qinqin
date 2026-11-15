import haoRaw from '../../../node_modules/hanzi-writer-data/好.json?raw';
import { describe, expect, it } from 'vitest';
import * as model from '../../../scripts/writing-ink-model.mjs';
import { matchStroke } from './matcher';
import { parseStrokeData, type Pt } from './strokes';

// The owner signed off the feel of 好 ("the writer is perfect now"): hardening must never make
// it stricter. Every hand-model variant of each of its six strokes, many seeds.
const hao = parseStrokeData('好', JSON.parse(haoRaw))!.medians;
const variants = (m: Pt[], seed: number): [string, Pt[]][] => model.correctVariants(m, model.mulberry32(seed), 4);

describe('好 feel (owner-approved, must not get stricter)', () => {
	hao.forEach((m, i) => {
		it(`stroke ${i + 1}: at least 97 % of hand-drawn variants match`, () => {
			let ok = 0;
			let total = 0;
			for (let seed = 1; seed <= 20; seed++) {
				for (const [, ink] of variants(m, 1000 * i + seed)) {
					const r = matchStroke(ink, hao, i);
					total++;
					if (r.kind === 'match' && r.strokes.length === 1 && r.strokes[0] === i) ok++;
				}
			}
			expect(ok / total).toBeGreaterThanOrEqual(0.97);
		});
	});

	it('stroke 2 as a vague straight line, strokes 4 and 5 with their corner and hook in any form', () => {
		const cases: [number, Pt[] | null][] = [
			[1, model.straight(hao[1])],
			[3, model.cornerRounded(hao[3])],
			[4, model.hookOmitted(hao[4])],
			[4, model.hookExaggerated(hao[4])],
			[4, model.hookExaggerated(hao[4], 3)]
		];
		for (const [i, ink] of cases) {
			expect(ink).not.toBeNull();
			expect(matchStroke(ink!, hao, i)).toMatchObject({ kind: 'match', strokes: [i] });
		}
	});
});
