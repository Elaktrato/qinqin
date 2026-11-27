import { centroid, dist, joinPaths, pathLength, resample, rmsRadius, turnDeg } from './geometry';
import { MATCH } from './params';
import type { Pt } from './strokes';

export type MissReason = 'direction' | 'shape' | 'placement' | 'order';
export type MatchResult =
	| { kind: 'match'; strokes: number[]; score: number }
	| { kind: 'miss'; reason: MissReason }
	| { kind: 'ignored' };

type Judged = { ok: true; score: number } | { ok: false; reason: Exclude<MissReason, 'order'> };

/** One form of a path, resampled, and the arc-length range of the full path it covers. */
interface Form {
	pts: Pt[];
	from: number;
	to: number;
}

/** A path in the forms the matcher compares: whole, and with its entry tick and hook cut off. */
interface Forms {
	full: Form;
	/** Entry tick removed (or the whole path when it has none). */
	body: Form;
	/** Hook removed from `body`, or null when the path ends without one. */
	hookless: Form | null;
	/** Direction of the hook (from where it turns to its tip), when there is one. */
	hook: Pt | null;
	/** Arc-length positions where one stroke of a join hands over to the next. */
	bounds: number[];
}

const DENSE = 64;

/**
 * Where a short end piece turns off the body: the index of the sharpest turn (body chord over
 * `MATCH.cutBody` of the length, then straight to the path's end), or -1 when no turn reaches
 * `minTurn` within the last `maxLen` of the path.
 */
function endCut(dense: readonly Pt[], len: number, maxLen: number, minTurn: number): number {
	const n = dense.length - 1;
	const step = len / n;
	if (!(step > 0)) return -1;
	const back = Math.max(1, Math.round((MATCH.cutBody * len) / step));
	const shortest = Math.max(1, Math.ceil(Math.max(MATCH.minHook, MATCH.minHookShare * len) / step));
	const half = Math.max(1, back >> 1);
	let best = -1;
	let bestTurn = minTurn;
	for (let i = n - shortest; i >= back && (n - i) * step <= maxLen; i--) {
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

/**
 * Index range of the ink without a tiny flick back at either end (a pen-lift recoil or a
 * lead-in): a piece of at most `MATCH.recoilMax` that turns back by `MATCH.recoilTurn` or more.
 */
function withoutRecoil(dense: readonly Pt[], len: number): [number, number] {
	const n = dense.length - 1;
	const step = len / n;
	if (!(step > 0)) return [0, n];
	const limit = Math.min(MATCH.recoilMax, MATCH.recoilShare * len);
	const back = Math.max(1, Math.round((0.2 * len) / step));
	const cut = (p: readonly Pt[]): number => {
		let best = n;
		let bestTurn: number = MATCH.recoilTurn;
		for (let i = n - 1; i >= back && (n - i) * step <= limit; i--) {
			const t = turnDeg(p[i - back], p[i], p[n]);
			if (t >= bestTurn) {
				bestTurn = t;
				best = i;
			}
		}
		return best;
	};
	const end = cut(dense);
	const start = n - cut([...dense].reverse());
	return start < end ? [start, end] : [0, n];
}

/**
 * The forms of a path. `strokes` (a stroke's or a join's medians) bounds the cuts: an entry tick
 * lies inside the first stroke and a hook inside the last, never a whole stroke of a join.
 * Without it (the learner's ink) there is no entry tick and the hook may be up to `MATCH.inkTailMax`.
 */
function forms(path: readonly Pt[], strokes?: readonly (readonly Pt[])[]): Forms {
	const n = MATCH.resample;
	let dense = resample(path, DENSE);
	if (!strokes) {
		const [i, j] = withoutRecoil(dense, pathLength(dense));
		if (i > 0 || j < DENSE - 1) dense = resample(dense.slice(i, j + 1), DENSE);
	}
	const len = pathLength(dense);
	const step = len / (DENSE - 1);
	const bounds: number[] = [];
	let head = 0;
	let tailLimit = MATCH.inkTailMax * len;
	if (strokes) {
		const lens = strokes.map((m) => pathLength(m));
		let at = 0;
		for (let k = 0; k + 1 < strokes.length; k++) {
			const gap = dist(strokes[k].at(-1)!, strokes[k + 1][0]);
			bounds.push(at + lens[k] + gap / 2);
			at += lens[k] + gap;
		}
		const h = endCut([...dense].reverse(), len, Math.min(MATCH.headMax * len, MATCH.maxCutShare * lens[0]), MATCH.headTurn);
		if (h > 0) head = DENSE - 1 - h;
		tailLimit = Math.min(MATCH.tailMax * len, MATCH.maxCutShare * lens.at(-1)!);
	}
	let tail = endCut(dense, len, tailLimit, MATCH.tailTurn);
	if (tail <= head) tail = -1;
	const form = (i: number, j: number): Form => ({ pts: resample(dense.slice(i, j + 1), n), from: i * step, to: j * step });
	const full = form(0, DENSE - 1);
	const body = head > 0 ? form(head, DENSE - 1) : full;
	const hookless = tail > 0 ? form(head, tail) : null;
	const hook = tail > 0 ? { x: dense[DENSE - 1].x - dense[tail].x, y: dense[DENSE - 1].y - dense[tail].y } : null;
	return { full, body, hookless, hook, bounds };
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

function chordOf(p: readonly Pt[], i: number, j: number): Pt {
	return { x: p[j].x - p[i].x, y: p[j].y - p[i].y };
}

/**
 * Compares ink `a` with candidate `b` (both resampled to the same count). `sections` are the
 * indices where a join's strokes hand over; each stroke of a join keeps its own direction.
 */
function compare(a: readonly Pt[], b: readonly Pt[], penalty: number, sections: number[]): Judged {
	const lenB = pathLength(b);
	const last = a.length - 1;
	// Direction: overall start→end, generous; reversed or crossways strokes fail here.
	if (Math.hypot(...xy(chordOf(b, 0, last))) >= MATCH.minChord * lenB && cosine(chordOf(a, 0, last), chordOf(b, 0, last)) < MATCH.minCos) {
		return { ok: false, reason: 'direction' };
	}
	// Each half on its own as well, and each stroke of a join, so a reversed or looping path
	// cannot pass on its ends alone.
	const h = a.length >> 1;
	const cuts = [0, ...sections, last];
	const pieces: [number, number][] = [[0, h], [h, last]];
	if (sections.length) for (let k = 1; k < cuts.length; k++) pieces.push([cuts[k - 1], cuts[k]]);
	for (const [i, j] of pieces) {
		if (j - i < 1) continue;
		const ub = chordOf(b, i, j);
		if (Math.hypot(ub.x, ub.y) >= MATCH.minChord * pathLength(b.slice(i, j + 1)) && cosine(chordOf(a, i, j), ub) < MATCH.minHalfCos) {
			return { ok: false, reason: 'direction' };
		}
	}
	// Placement: position and size are forgiven within wide bounds. Sizes below sizeFloor count
	// as sizeFloor, so a dot drawn small is not "too small".
	const ca = centroid(a);
	const cb = centroid(b);
	const ra = rmsRadius(a, ca);
	const rb = rmsRadius(b, cb);
	const ratio = Math.max(ra, MATCH.sizeFloor) / Math.max(rb, MATCH.sizeFloor);
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

const xy = (p: Pt): [number, number] => [p.x, p.y];

/** Section indices of a join's stroke hand-overs inside one candidate form. */
function sectionsOf(f: Form, bounds: readonly number[]): number[] {
	const last = f.pts.length - 1;
	const span = f.to - f.from;
	if (!(span > 0)) return [];
	return bounds
		.map((b) => Math.round(((b - f.from) / span) * last))
		.filter((i) => i > 0 && i < last);
}

/**
 * Best fit of the ink to a candidate over the forgiving forms: entry tick optional, and on a
 * stroke that ends in a hook the hook may be missing, drawn as asked, or exaggerated.
 */
function judge(ink: Forms, cand: Forms): Judged {
	const tries: [Form, Form, number][] = [
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
	// A join pays for each stroke beyond the first, so a single stroke is not credited as two.
	const extra = MATCH.joinCost * cand.bounds.length;
	let best: Judged | null = null;
	let first: Judged | null = null;
	for (const [a, b, p] of tries) {
		const j = compare(a.pts, b.pts, p + extra, sectionsOf(b, cand.bounds));
		first ??= j;
		if (j.ok && (best === null || (best.ok && j.score < best.score))) best = j;
	}
	return best ?? first!;
}

/** The direction a stroke ends in: the chord over its last `MATCH.flowTail` of length (at least `flowTailMin`). */
function endDirection(m: readonly Pt[]): Pt {
	const end = m.at(-1)!;
	const want = Math.max(MATCH.flowTailMin, MATCH.flowTail * pathLength(m));
	let run = 0;
	for (let i = m.length - 2; i >= 0; i--) {
		run += dist(m[i], m[i + 1]);
		if (run >= want) return { x: end.x - m[i].x, y: end.y - m[i].y };
	}
	return { x: end.x - m[0].x, y: end.y - m[0].y };
}

/**
 * How the pen gets from stroke `a` to stroke `b` in one motion: `near` when `b` starts within `MATCH.maxGap` of
 * where `a` ends (the gap rule), `flow` when `a` ends pointing at `b`'s start (within ±60°), at most `MATCH.flowGap`
 * away, and `b` does not come back past where `a` ended (the flow rule, #292: a hook or flick that leads into the
 * next stroke, as in き 3+4 or さ 2+3), else null.
 */
export function joinLink(a: readonly Pt[], b: readonly Pt[]): 'near' | 'flow' | null {
	const end = a.at(-1)!;
	const gap = { x: b[0].x - end.x, y: b[0].y - end.y };
	const length = Math.hypot(gap.x, gap.y);
	if (length <= MATCH.maxGap) return 'near';
	if (length > MATCH.flowGap || cosine(endDirection(a), gap) < MATCH.flowCos) return null;
	// A next stroke that runs back past where `a` ended would retrace the move to it (口's 横折 + 横): no flow.
	let clear = Infinity;
	for (let i = 1; i < b.length; i++) clear = Math.min(clear, segDist(end, b[i - 1], b[i]));
	return clear >= MATCH.flowClear * length ? 'flow' : null;
}

/**
 * The candidates starting at stroke `from`: the stroke alone and the joins of the strokes after it that the pen
 * reaches in one motion (`joinLink`), up to `MATCH.maxJoin`. A flow link only joins two strokes: a longer join
 * through it would let a short stroke be skipped on the way (measured: more skipped strokes credited, no join gained).
 */
function candidates(medians: readonly Pt[][], from: number): number[][] {
	const out = [[from]];
	for (let k = 2; k <= MATCH.maxJoin && from + k - 1 < medians.length; k++) {
		const link = joinLink(medians[from + k - 2], medians[from + k - 1]);
		if (link === null || (link === 'flow' && k > 2)) break;
		out.push(Array.from({ length: k }, (_, i) => from + i));
		if (link === 'flow') break;
	}
	return out;
}

const formsCache = new WeakMap<readonly Pt[][], Map<string, Forms>>();
function strokeForms(medians: readonly Pt[][], idx: number[]): Forms {
	let m = formsCache.get(medians);
	if (!m) formsCache.set(medians, (m = new Map()));
	const key = idx.join(',');
	let f = m.get(key);
	if (!f) {
		const parts = idx.map((i) => medians[i]);
		m.set(key, (f = forms(joinPaths(parts), parts)));
	}
	return f;
}

const finite = (p: Pt) => Number.isFinite(p.x) && Number.isFinite(p.y);

/** Whether the ink fits some candidate other than those starting at `next`, by more than `margin` below `than`. */
function rivalFits(inkForms: Forms, medians: readonly Pt[][], next: number, than: number): boolean {
	for (let from = 0; from < medians.length; from++) {
		if (from === next) continue;
		for (const idx of candidates(medians, from)) {
			const j = judge(inkForms, strokeForms(medians, idx));
			if (j.ok && j.score + MATCH.rankMargin < than) return true;
		}
	}
	return false;
}

export function matchStroke(ink: readonly Pt[], medians: readonly Pt[][], next: number): MatchResult {
	if (ink.length < 2 || !ink.every(finite) || pathLength(ink) < MATCH.minInk || next < 0 || next >= medians.length) {
		return { kind: 'ignored' };
	}
	const inkForms = forms(ink);

	let best: { strokes: number[]; score: number } | null = null;
	let firstMiss: Judged | null = null;
	for (const idx of candidates(medians, next)) {
		const j = judge(inkForms, strokeForms(medians, idx));
		firstMiss ??= j;
		// Ties prefer fewer strokes: only a strictly better score replaces.
		if (j.ok && (best === null || j.score < best.score)) best = { strokes: idx, score: j.score };
	}
	// Order (rank, not threshold): ink that fits any other stroke or join of the character
	// clearly better than the expected one was meant for that stroke (drawn out of order, or an
	// earlier stroke drawn again), however well it fits the expected one. Ink that fits only
	// another stroke is reported the same way.
	if (rivalFits(inkForms, medians, next, best ? best.score : Infinity)) return { kind: 'miss', reason: 'order' };
	if (!best) return { kind: 'miss', reason: (firstMiss as { reason: Exclude<MissReason, 'order'> }).reason };
	return { kind: 'match', ...best };
}
