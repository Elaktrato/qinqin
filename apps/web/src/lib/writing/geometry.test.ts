import liaoRaw from '../../../node_modules/hanzi-writer-data/了.json?raw';
import { describe, expect, it } from 'vitest';
import { centroid, dist, joinPaths, pathLength, resample, rmsRadius } from './geometry';
import { parseStrokeData } from './strokes';

describe('geometry', () => {
	it('pathLength of a unit square is 4', () => {
		const sq = [
			{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }
		];
		expect(pathLength(sq)).toBeCloseTo(4);
	});
	it('resample spaces points evenly and keeps ends', () => {
		const r = resample([{ x: 0, y: 0 }, { x: 1, y: 0 }], 5);
		expect(r.map((p) => p.x)).toEqual([0, 0.25, 0.5, 0.75, 1].map((v) => expect.closeTo(v)));
		expect(r[0]).toEqual({ x: 0, y: 0 });
		expect(r[4].x).toBeCloseTo(1);
	});
	it('resample of a single point gives n copies', () => {
		expect(resample([{ x: 0.2, y: 0.3 }], 3)).toEqual(Array(3).fill({ x: 0.2, y: 0.3 }));
	});
	it('centroid, rmsRadius and dist', () => {
		const pts = [{ x: 0, y: 0 }, { x: 2, y: 0 }];
		expect(centroid(pts)).toEqual({ x: 1, y: 0 });
		expect(rmsRadius(pts)).toBeCloseTo(1);
		expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
	});
	it('joinPaths connects end to next start', () => {
		const s = parseStrokeData(
			'了',
			JSON.parse(liaoRaw)
		)!;
		const [a, b] = s.medians;
		const joined = joinPaths(s.medians);
		expect(pathLength(joined)).toBeCloseTo(pathLength(a) + pathLength(b) + dist(a[a.length - 1], b[0]), 5);
		expect(dist(a[a.length - 1], b[0])).toBeCloseTo(0.05, 1);
	});
});
