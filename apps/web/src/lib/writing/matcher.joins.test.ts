import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/joins.json';
import { joinLink, matchStroke } from './matcher';
import type { Pt } from './strokes';

// Joined strokes on real Japanese stroke data (#292): KanjiVG medians, made by scripts/make-join-fixtures.mjs
// (format: the file's "format" field; the Kotlin port runs the same cases).
type Expect = { kind: string; strokes?: number[]; reason?: string };
const unflat = (a: readonly number[]): Pt[] => {
	const out: Pt[] = [];
	for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i] / fixtures.scale, y: a[i + 1] / fixtures.scale });
	return out;
};
const chars: Record<string, Pt[][]> = Object.fromEntries(
	Object.entries(fixtures.chars as Record<string, number[][]>).map(([ch, ms]) => [ch, ms.map(unflat)])
);
const links = fixtures.links as Record<string, ('near' | 'flow' | null)[]>;
const cases = (fixtures.cases as { name: string; char: string; next: number; ink: number[]; expect: Expect }[]).map((c) => ({
	...c,
	ink: unflat(c.ink)
}));

describe('which strokes the pen joins (joinLink)', () => {
	for (const [ch, want] of Object.entries(links)) {
		it(`${ch}: ${want.map((l, k) => `${k + 1}+${k + 2} ${l ?? 'no'}`).join(', ')}`, () => {
			const ms = chars[ch];
			expect(want.map((_, k) => joinLink(ms[k], ms[k + 1]))).toEqual(want);
		});
	}
	it('き 3+4 is a join by the flow rule, not by the gap rule: the hook points at the bottom curve', () => {
		const ki = chars['き'];
		const end = ki[2].at(-1)!;
		expect(Math.hypot(ki[3][0].x - end.x, ki[3][0].y - end.y)).toBeGreaterThan(0.3);
		expect(joinLink(ki[2], ki[3])).toBe('flow');
	});
});

describe('joined strokes (KanjiVG fixtures)', () => {
	for (const { name, char, next, ink, expect: e } of cases) {
		it(name, () => {
			const r = matchStroke(ink, chars[char], next);
			expect(r.kind).toBe(e.kind);
			if (e.strokes) expect(r.kind === 'match' && r.strokes).toEqual(e.strokes);
			if (e.reason) expect(r.kind === 'miss' && r.reason).toBe(e.reason);
		});
	}
});

describe('き written the two ways', () => {
	const ki = chars['き'];
	it('strokes 3 and 4 drawn separately are accepted one at a time', () => {
		expect(matchStroke(ki[2], ki, 2)).toMatchObject({ kind: 'match', strokes: [2] });
		expect(matchStroke(ki[3], ki, 3)).toMatchObject({ kind: 'match', strokes: [3] });
	});
	it('strokes 3 and 4 in one motion are accepted together; 1+3 in one motion is a miss', () => {
		expect(matchStroke([...ki[2], ...ki[3]], ki, 2)).toMatchObject({ kind: 'match', strokes: [2, 3] });
		expect(matchStroke([...ki[0], ...ki[2]], ki, 0).kind).toBe('miss');
	});
	it('the bottom curve alone is not credited as the join of 3 and 4', () => {
		const r = matchStroke(ki[3], ki, 2);
		expect(r.kind === 'match' && r.strokes.length > 1).toBe(false);
	});
});

describe('a flow join covers two strokes, never three', () => {
	it('以: 1+2 by the gap rule and 2+3 by the flow rule, but 1+2+3 in one motion is not a join', () => {
		const yi = chars['以'];
		expect(matchStroke([...yi[0], ...yi[1]], yi, 0)).toMatchObject({ kind: 'match', strokes: [0, 1] });
		expect(matchStroke([...yi[1], ...yi[2]], yi, 1)).toMatchObject({ kind: 'match', strokes: [1, 2] });
		expect(matchStroke([...yi[0], ...yi[1], ...yi[2]], yi, 0)).not.toMatchObject({ kind: 'match', strokes: [0, 1, 2] });
	});
	it('ふ: 2+3 and 3+4 by the flow rule, but 2+3+4 in one motion is not a join', () => {
		const fu = chars['ふ'];
		expect(matchStroke([...fu[1], ...fu[2], ...fu[3]], fu, 1)).not.toMatchObject({ kind: 'match', strokes: [1, 2, 3] });
		expect(matchStroke([...fu[2], ...fu[3]], fu, 2)).toMatchObject({ kind: 'match', strokes: [2, 3] });
	});
});

describe('every kana and kanji of the fixture: no stroke drawn alone is credited as a join', () => {
	for (const [ch, ms] of Object.entries(chars)) {
		it(ch, () => {
			ms.forEach((m, i) => expect(matchStroke(m, ms, i)).toMatchObject({ kind: 'match', strokes: [i] }));
			for (let i = 0; i + 1 < ms.length; i++) {
				const r = matchStroke(ms[i + 1], ms, i);
				expect(r.kind === 'match' && r.strokes.length > 1).toBe(false);
			}
		});
	}
});
