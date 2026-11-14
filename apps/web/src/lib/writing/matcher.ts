import { centroid, dist, joinPaths, pathLength, resample, rmsRadius } from './geometry';
import { MATCH } from './params';
import type { Pt } from './strokes';

export type MatchResult =
	| { kind: 'match'; strokes: number[]; score: number }
	| { kind: 'miss'; reason: 'direction' | 'shape' | 'placement' }
	| { kind: 'ignored' };

type Judged = { ok: true; score: number } | { ok: false; reason: 'direction' | 'shape' | 'placement' };

function judge(ink: readonly Pt[], candidate: readonly Pt[]): Judged {
	const a = resample(ink, MATCH.resample);
	const b = resample(candidate, MATCH.resample);

	// Direction, judged relative to each path's centroid so that a shifted stroke is not
	// mistaken for a reversed one (placement is judged separately below).
	const ca = centroid(a);
	const cb = centroid(b);
	const a0 = { x: a[0].x - ca.x, y: a[0].y - ca.y };
	const a1 = { x: a[a.length - 1].x - ca.x, y: a[a.length - 1].y - ca.y };
	const b0 = { x: b[0].x - cb.x, y: b[0].y - cb.y };
	const b1 = { x: b[b.length - 1].x - cb.x, y: b[b.length - 1].y - cb.y };
	if (dist(a0, b0) >= dist(a0, b1)) return { ok: false, reason: 'direction' };
	const va = { x: a1.x - a0.x, y: a1.y - a0.y };
	const vb = { x: b1.x - b0.x, y: b1.y - b0.y };
	const na = Math.hypot(va.x, va.y);
	const nb = Math.hypot(vb.x, vb.y);
	const cos = na === 0 || nb === 0 ? 0 : (va.x * vb.x + va.y * vb.y) / (na * nb);
	if (cos < MATCH.minCos) return { ok: false, reason: 'direction' };

	// Placement
	const ra = rmsRadius(a, ca);
	const rb = rmsRadius(b, cb);
	const lenB = pathLength(b);
	const ratio = rb < 0.01 ? pathLength(a) / (lenB || 1) : ra / rb;
	if (dist(ca, cb) > MATCH.maxOffset || ratio < MATCH.minScale || ratio > MATCH.maxScale) {
		return { ok: false, reason: 'placement' };
	}

	// Shape in the candidate frame
	const s = ra === 0 ? 1 : rb / ra;
	let sum = 0;
	let startErr = 0;
	let endErr = 0;
	for (let i = 0; i < a.length; i++) {
		const m = { x: (a[i].x - ca.x) * s + cb.x, y: (a[i].y - ca.y) * s + cb.y };
		const d = dist(m, b[i]);
		sum += d;
		if (i === 0) startErr = d;
		if (i === a.length - 1) endErr = d;
	}
	// Endpoint anchoring: aligned ink start and end must sit near the candidate's.
	const tol = Math.max(MATCH.maxEnd * lenB, MATCH.minEndTol);
	if (startErr > tol || endErr > tol) return { ok: false, reason: 'shape' };
	const score = sum / a.length / (lenB || 1);
	if (score > MATCH.maxShape) return { ok: false, reason: 'shape' };
	return { ok: true, score };
}

export function matchStroke(ink: readonly Pt[], medians: readonly Pt[][], next: number): MatchResult {
	if (ink.length < 2 || pathLength(ink) < MATCH.minInk || next < 0 || next >= medians.length) {
		return { kind: 'ignored' };
	}
	const single = judge(ink, medians[next]);
	let best: { strokes: number[]; score: number } | null = single.ok
		? { strokes: [next], score: single.score }
		: null;

	for (let k = 2; k <= MATCH.maxJoin && next + k - 1 < medians.length; k++) {
		const gap = dist(medians[next + k - 2].at(-1)!, medians[next + k - 1][0]);
		if (gap > MATCH.maxGap) break;
		const idx = Array.from({ length: k }, (_, i) => next + i);
		const j = judge(ink, joinPaths(idx.map((i) => medians[i])));
		// Ties prefer fewer strokes: only a strictly better score replaces.
		if (j.ok && (best === null || j.score < best.score)) best = { strokes: idx, score: j.score };
	}
	if (best) return { kind: 'match', ...best };
	return { kind: 'miss', reason: (single as { reason: 'direction' | 'shape' | 'placement' }).reason };
}
