import dengRaw from '../../../node_modules/hanzi-writer-data/等.json?raw';
import yiRaw from '../../../node_modules/hanzi-writer-data/一.json?raw';
import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/strokes.json';
import { matchStroke } from './matcher';
import { parseStrokeData, type Pt } from './strokes';

// Fixture format: see scripts/make-writing-fixtures.mjs (flat integer arrays x scale).
type Expect = { kind: string; strokes?: number[]; reason?: string };
const unflat = (a: readonly number[]): Pt[] => {
	const out: Pt[] = [];
	for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i] / fixtures.scale, y: a[i + 1] / fixtures.scale });
	return out;
};
const chars: Record<string, Pt[][]> = Object.fromEntries(
	Object.entries(fixtures.chars as Record<string, number[][]>).map(([ch, ms]) => [ch, ms.map(unflat)])
);
const cases = (fixtures.cases as { name: string; char: string; next: number; ink: number[]; expect: Expect }[]).map((c) => ({
	...c,
	ink: unflat(c.ink)
}));

describe('matchStroke fixtures', () => {
	for (const { name, char, next, ink, expect: e } of cases) {
		it(name, () => {
			const r = matchStroke(ink, chars[char], next);
			expect(r.kind).toBe(e.kind);
			if (e.strokes) expect(r.kind === 'match' && r.strokes).toEqual(e.strokes);
			if (e.reason) expect(r.kind === 'miss' && r.reason).toBe(e.reason);
		});
	}
});

describe('joins', () => {
	const deng = parseStrokeData('等', JSON.parse(dengRaw))!.medians;
	it('a single stroke drawn on its own is never credited as a join', () => {
		for (const ch of ['通', '张', '东', '新', '别', '回']) {
			chars[ch]?.forEach((m, i) => expect(matchStroke(m, chars[ch], i)).toMatchObject({ kind: 'match', strokes: [i] }));
		}
	});
	it('a stroke drawn backwards does not pass as a join running the other way (等)', () => {
		for (let i = 0; i < deng.length; i++) expect(matchStroke([...deng[i]].reverse(), deng, i).kind).toBe('miss');
	});
	it('the next stroke drawn alone is not credited as a join of the expected stroke and it', () => {
		for (const ch of ['第', '高', '却']) {
			const ms = chars[ch];
			for (let i = 0; i + 1 < ms.length; i++) {
				const r = matchStroke(ms[i + 1], ms, i);
				expect(r.kind === 'match' && r.strokes.length > 1).toBe(false);
			}
		}
	});
	it('a join pays for its extra stroke: a stroke followed by a tiny one is matched alone', () => {
		const a = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }];
		const tiny = [{ x: 0.81, y: 0.5 }, { x: 0.83, y: 0.52 }];
		expect(matchStroke(a, [a, tiny], 0)).toMatchObject({ kind: 'match', strokes: [0] });
	});
});

describe('ink that cannot be judged', () => {
	const yi = parseStrokeData('一', JSON.parse(yiRaw))!.medians;
	it('is ignored when any point is not finite', () => {
		expect(matchStroke([{ x: NaN, y: NaN }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 }], yi, 0).kind).toBe('ignored');
		expect(matchStroke([{ x: Infinity, y: 0.5 }, { x: Infinity, y: 0.6 }], yi, 0).kind).toBe('ignored');
	});
	it('is ignored as a tap, or for a stroke index outside the character', () => {
		expect(matchStroke([{ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.5 }], yi, 0).kind).toBe('ignored');
		expect(matchStroke(yi[0], yi, 1).kind).toBe('ignored');
	});
});

describe('single-stroke character (一)', () => {
	const yi = parseStrokeData('一', JSON.parse(yiRaw))!.medians;
	it('matches the stroke, a shifted copy and a straight line; misses it reversed or upright', () => {
		expect(matchStroke(yi[0], yi, 0)).toMatchObject({ kind: 'match', strokes: [0] });
		expect(matchStroke(yi[0].map((p) => ({ x: p.x, y: p.y + 0.15 })), yi, 0)).toMatchObject({ kind: 'match', strokes: [0] });
		expect(matchStroke([{ x: 0.15, y: 0.5 }, { x: 0.85, y: 0.47 }], yi, 0)).toMatchObject({ kind: 'match', strokes: [0] });
		expect(matchStroke([...yi[0]].reverse(), yi, 0)).toMatchObject({ kind: 'miss', reason: 'direction' });
		expect(matchStroke([{ x: 0.5, y: 0.15 }, { x: 0.5, y: 0.85 }], yi, 0)).toMatchObject({ kind: 'miss', reason: 'direction' });
	});
});

describe('ties', () => {
	const a = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }];
	it('go to the expected stroke when another stroke fits exactly as well', () => {
		expect(matchStroke(a, [a, a.map((p) => ({ ...p }))], 0)).toMatchObject({ kind: 'match', strokes: [0] });
		expect(matchStroke(a, [a, a.map((p) => ({ ...p }))], 1)).toMatchObject({ kind: 'match', strokes: [1] });
	});
});

describe('hands', () => {
	const yi = parseStrokeData('一', JSON.parse(yiRaw))!.medians;
	it('a dot drawn much smaller than shown still counts (size floor)', () => {
		const yong = chars['永'];
		const [s, e] = [yong[0][0], yong[0].at(-1)!];
		const small = [s, { x: s.x + (e.x - s.x) * 0.2, y: s.y + (e.y - s.y) * 0.2 }];
		expect(matchStroke(small, yong, 0)).toMatchObject({ kind: 'match', strokes: [0] });
	});
	it('a tiny flick back at the end of a stroke (pen-lift recoil) is forgiven', () => {
		const ink = [...yi[0], { x: yi[0].at(-1)!.x - 0.02, y: yi[0].at(-1)!.y + 0.01 }];
		expect(matchStroke(ink, yi, 0)).toMatchObject({ kind: 'match', strokes: [0] });
	});
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
