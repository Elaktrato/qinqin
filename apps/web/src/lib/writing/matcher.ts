import { centroid, dist, joinPaths, pathLength, resample, rmsRadius, turnDeg } from './geometry';
import { MATCH } from './params';
import type { Pt } from './strokes';

export type MissReason = 'direction' | 'shape' | 'placement' | 'order';
export type MatchResult =
	| { kind: 'match'; strokes: number[]; score: number }
	| { kind: 'miss'; reason: MissReason }
	| { kind: 'ignored' };

type Judged = { ok: true; score: number } | { ok: false; reason: Exclude<MissReason, 'order'> };

/** A path in the forms the matcher compares: whole, and with its entry tick and hook cut off. */
interface Forms {
	full: Pt[];
	/** Entry tick removed (or the whole path when it has none). */
	body: Pt[];
	/** Hook removed from `body`, or null when the path ends without one. */
	hookless: Pt[] | null;
	/** Direction of the hook (from where it turns to its tip), when there is one. */
	hook: Pt | null;
}

const DENSE = 64;

/**
 * Where a short end piece turns off the body: the index of the sharpest turn (body chord over
 * `MATCH.cutBody` of the length, then straight to the path's end), or -1 when no turn reaches
 * `minTurn` or the sharpest one leaves more than `maxShare` of the length beyond it.
 */
function endCut(dense: readonly Pt[], len: number, maxShare: number, minTurn: number): number {
	const n = dense.length - 1;
	const step = len / n;
	const back = Math.max(1, Math.round((MATCH.cutBody * len) / step));
	const shortest = Math.max(1, Math.ceil(Math.max(MATCH.minHook, MATCH.minHookShare * len) / step));
	const half = Math.max(1, back >> 1);
	let best = -1;
	let bestTurn = minTurn;
	for (let i = n - shortest; i >= back && (n - i) * step <= maxShare * len; i--) {
		// The body chord must not itself bend round a corner: a cut part-way along the long leg
		// after a corner would otherwise look like a hook.
		if (turnDeg(dense[i - back], dense[i - half], dense[i]) > MATCH.cutStraight) continue;
		const t = turnDeg(dense[i - back], dense[i], dense[n]);
		if (t >= bestTurn) {
			bestTurn = t;
			best = i;
		}
	}
	return best;
}

function forms(path: readonly Pt[], tailMax: number, withHead: boolean): Forms {
	const n = MATCH.resample;
	const dense = resample(path, DENSE);
	const len = pathLength(dense);
	let head = 0;
	if (withHead) {
		const h = endCut([...dense].reverse(), len, MATCH.headMax, MATCH.headTurn);
		if (h > 0) head = DENSE - 1 - h;
	}
	let tail = endCut(dense, len, tailMax, MATCH.tailTurn);
	if (tail <= head) tail = -1;
	const full = resample(dense, n);
	const body = head > 0 ? resample(dense.slice(head), n) : full;
	const hookless = tail > 0 ? resample(dense.slice(head, tail + 1), n) : null;
	const hook = tail > 0 ? { x: dense[DENSE - 1].x - dense[tail].x, y: dense[DENSE - 1].y - dense[tail].y } : null;
	return { full, body, hookless, hook };
}

/** Largest distance from a point of `p` to the polyline `q`. */
function farthest(p: readonly Pt[], q: readonly Pt[]): number {
	let worst = 0;
	for (const pt of p) {
		let near = Infinity;
		for (let i = 1; i < q.length; i++) near = Math.min(near, segDist(pt, q[i - 1], q[i]));
		worst = Math.max(worst, near);
	}
	return worst;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const l2 = dx * dx + dy * dy;
	const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
	return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function cosine(u: Pt, v: Pt): number {
	const n = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
	return n === 0 ? -1 : (u.x * v.x + u.y * v.y) / n;
}

function compare(a: readonly Pt[], b: readonly Pt[], penalty: number): Judged {
	const lenB = pathLength(b);
	// Direction: overall start→end, generous; reversed or crossways strokes fail here.
	const va = { x: a.at(-1)!.x - a[0].x, y: a.at(-1)!.y - a[0].y };
	const vb = { x: b.at(-1)!.x - b[0].x, y: b.at(-1)!.y - b[0].y };
	const nb = Math.hypot(vb.x, vb.y);
	if (nb >= MATCH.minChord * lenB && cosine(va, vb) < MATCH.minCos) return { ok: false, reason: 'direction' };
	// Each half on its own as well, so a reversed or looping path cannot pass on its ends alone.
	const h = a.length >> 1;
	for (const [i, j] of [[0, h], [h, a.length - 1]]) {
		const ua = { x: a[j].x - a[i].x, y: a[j].y - a[i].y };
		const ub = { x: b[j].x - b[i].x, y: b[j].y - b[i].y };
		if (Math.hypot(ub.x, ub.y) >= MATCH.minChord * pathLength(b.slice(i, j + 1)) && cosine(ua, ub) < MATCH.minHalfCos) {
			return { ok: false, reason: 'direction' };
		}
	}
	// Placement: position and size are forgiven within wide bounds.
	const ca = centroid(a);
	const cb = centroid(b);
	const ra = rmsRadius(a, ca);
	const rb = rmsRadius(b, cb);
	const ratio = rb < 0.01 ? pathLength(a) / (lenB || 1) : ra / rb;
	const offset = dist(ca, cb);
	if (offset > MATCH.maxOffset || ratio < MATCH.minScale || ratio > MATCH.maxScale) {
		return { ok: false, reason: 'placement' };
	}
	// Shape in the candidate frame (translation and uniform scale removed).
	const s = ra === 0 ? 1 : rb / ra;
	const am = a.map((p) => ({ x: (p.x - ca.x) * s + cb.x, y: (p.y - ca.y) * s + cb.y }));
	let sum = 0;
	for (let i = 0; i < am.length; i++) sum += dist(am[i], b[i]);
	const norm = Math.min(Math.max(lenB, MATCH.shapeFloor), MATCH.shapeCap);
	const shape = sum / a.length / norm;
	if (shape > MATCH.maxShape) return { ok: false, reason: 'shape' };
	// Farthest excursion either way (a leg added or left out), not just the mean.
	if (Math.max(farthest(am, b), farthest(b, am)) / Math.max(lenB, MATCH.shapeFloor) > MATCH.maxDev) {
		return { ok: false, reason: 'shape' };
	}
	const score = shape + MATCH.offsetWeight * offset + MATCH.scaleWeight * Math.abs(Math.log(ratio)) + penalty;
	return { ok: true, score };
}

/**
 * Best fit of the ink to a candidate over the forgiving forms: entry tick optional, and on a
 * stroke that ends in a hook the hook may be missing, drawn as asked, or exaggerated.
 */
function judge(ink: Forms, cand: Forms): Judged {
	const tries: [Pt[], Pt[], number][] = [
		[ink.full, cand.full, 0],
		[ink.full, cand.body, 0]
	];
	if (cand.hookless) {
		tries.push([ink.full, cand.hookless, MATCH.trimPenalty]);
		// An exaggerated hook still has to point the hook's way.
		if (ink.hookless && cosine(ink.hook!, cand.hook!) >= MATCH.minHookCos) {
			tries.push([ink.hookless, cand.hookless, MATCH.trimPenalty]);
		}
	}
	let best: Judged | null = null;
	let first: Judged | null = null;
	for (const [a, b, p] of tries) {
		const j = compare(a, b, p);
		first ??= j;
		if (j.ok && (best === null || (best.ok && j.score < best.score))) best = j;
	}
	return best ?? first!;
}

/** The candidates starting at stroke `from`: the stroke alone and joins that flow on (gap limit). */
function candidates(medians: readonly Pt[][], from: number): number[][] {
	const out = [[from]];
	for (let k = 2; k <= MATCH.maxJoin && from + k - 1 < medians.length; k++) {
		if (dist(medians[from + k - 2].at(-1)!, medians[from + k - 1][0]) > MATCH.maxGap) break;
		out.push(Array.from({ length: k }, (_, i) => from + i));
	}
	return out;
}

const formsCache = new WeakMap<readonly Pt[][], Map<string, Forms>>();
function strokeForms(medians: readonly Pt[][], idx: number[]): Forms {
	let m = formsCache.get(medians);
	if (!m) formsCache.set(medians, (m = new Map()));
	const key = idx.join(',');
	let f = m.get(key);
	if (!f) m.set(key, (f = forms(joinPaths(idx.map((i) => medians[i])), MATCH.tailMax, true)));
	return f;
}

export function matchStroke(ink: readonly Pt[], medians: readonly Pt[][], next: number): MatchResult {
	if (ink.length < 2 || pathLength(ink) < MATCH.minInk || next < 0 || next >= medians.length) {
		return { kind: 'ignored' };
	}
	const inkForms = forms(ink, MATCH.inkTailMax, false);

	let best: { strokes: number[]; score: number } | null = null;
	let firstMiss: Judged | null = null;
	for (const idx of candidates(medians, next)) {
		const j = judge(inkForms, strokeForms(medians, idx));
		firstMiss ??= j;
		// Ties prefer fewer strokes: only a strictly better score replaces.
		if (j.ok && (best === null || j.score < best.score)) best = { strokes: idx, score: j.score };
	}
	if (!best) return { kind: 'miss', reason: (firstMiss as { reason: Exclude<MissReason, 'order'> }).reason };

	// Order (rank, not threshold): ink that fits any other stroke or join of the character
	// clearly better than the expected one was meant for that stroke (drawn out of order, or an
	// earlier stroke drawn again), however well it fits the expected one.
	for (let from = 0; from < medians.length; from++) {
		if (from === next) continue;
		for (const idx of candidates(medians, from)) {
			const j = judge(inkForms, strokeForms(medians, idx));
			if (j.ok && j.score + MATCH.rankMargin < best.score) return { kind: 'miss', reason: 'order' };
		}
	}
	return { kind: 'match', ...best };
}
