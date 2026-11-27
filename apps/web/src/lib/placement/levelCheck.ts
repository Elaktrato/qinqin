// The level check (#82), pure and deterministic given a seed. Method and
// limits: docs/superpowers/specs/2026-11-26-level-check-design.md.
//
// For a target level of a scheme (HSK 4, N3 ...) the lists of that level and
// of every level below it make the vocabulary the exam can ask. What the app
// already knows about the learner is exact and needs no question: an entry is
// known, learning or unseen by the shared predicate (lib/studycore/known.ts). Only
// the entries the app does not call known can still be known from elsewhere,
// so a seeded sample of them is asked, self-assessed, with the placement
// test's generator (`pick`). The sample is stratified by level (the questions
// are shared out evenly over the levels, a small level giving all it has), so
// every level has its own yes-rate and its own 90 % Wilson range:
// readiness of a level = (known + rate * not-yet-known) / total. A level with
// fewer than MIN_LEVEL_ANSWERS answers borrows the pooled rate and says so. A
// level whose not-yet-known entries were all asked is exact. No I/O, no
// clock, no Math.random.

import { familiarity, type KnownIndex } from '$lib/studycore/known';
import type { LevelMembers } from './declare';
import { pick } from './placement';

export const SAMPLE_SIZE = 20;
/** A level needs this many answers to be judged on its own rate. */
export const MIN_LEVEL_ANSWERS = 3;
/** A level (or the whole range) counts as covered from this share on. */
export const READY_SHARE = 0.9;
/** z of a two-sided 90 % interval. */
const Z = 1.645;

export interface Coverage {
	known: number;
	learning: number;
	unseen: number;
	total: number;
}

export interface LevelCoverage extends Coverage {
	name: string;
}

export interface CheckPlan {
	/** The levels up to the target, in level order; an entry counts at its first level only. */
	levels: LevelCoverage[];
	total: Coverage;
	/** The entries to ask, in order: distinct, none known by the app, level by level. */
	sample: number[];
	/** For each sample entry the index into `levels` it belongs to. */
	sampleLevel: number[];
}

export type Readiness = 'early' | 'partway' | 'close' | 'ready';

export interface LevelEstimate {
	name: string;
	share: number;
	low: number;
	high: number;
	asked: number;
	/** All of the level's not-yet-known entries were asked (or it has none): no range. */
	exact: boolean;
	/** Too few answers for this level: the pooled rate of all levels was used. */
	pooled: boolean;
}

export interface CheckEstimate {
	asked: number;
	yes: number;
	/** Point estimate of the share of the range the learner knows, 0..1. */
	share: number;
	/** 90 % range of `share`; `low` is the data alone plus the lower end of the sampled shares. */
	low: number;
	high: number;
	/** Every not-yet-known entry of the range was asked: the result is exact, there is no range. */
	exact: boolean;
	band: Readiness;
	perLevel: LevelEstimate[];
	/** The lowest level that is not ready yet (1-based position in the scheme's levels), or null. */
	next: { position: number; name: string } | null;
}

export interface PlanConfig {
	levels: readonly LevelMembers[];
	/** 1-based position of the target level in `levels`. */
	target: number;
	index: KnownIndex;
	seed: number;
	sampleSize?: number;
}

/** Share `size` questions evenly over the pools, a pool never giving more than it has; the rest goes to the others, lower levels first. */
function allocate(capacity: readonly number[], size: number): number[] {
	const out = capacity.map(() => 0);
	let left = Math.min(size, capacity.reduce((a, b) => a + b, 0));
	while (left > 0) {
		const open = capacity.map((_, i) => i).filter((i) => out[i] < capacity[i]);
		const each = Math.max(1, Math.floor(left / open.length));
		for (const i of open) {
			if (left <= 0) break;
			const give = Math.min(each, capacity[i] - out[i], left);
			out[i] += give;
			left -= give;
		}
	}
	return out;
}

/** planCheck: the coverage by the learner's data and the sample to ask. */
export function planCheck(config: PlanConfig): CheckPlan {
	const { levels, target, index } = config;
	if (!Number.isInteger(target) || target < 1 || target > levels.length) throw new Error('level check: target outside the levels');
	const seen = new Set<number>();
	const pools: number[][] = [];
	const rows: LevelCoverage[] = [];
	for (const level of levels.slice(0, target)) {
		const row: LevelCoverage = { name: level.name, known: 0, learning: 0, unseen: 0, total: 0 };
		const pool: number[] = [];
		for (const id of level.entryIds) {
			if (seen.has(id)) continue;
			seen.add(id);
			row.total += 1;
			const state = familiarity(id, index);
			if (state === 'known') row.known += 1;
			else {
				if (state === 'learning') row.learning += 1;
				else row.unseen += 1;
				pool.push(id);
			}
		}
		pools.push(pool);
		rows.push(row);
	}
	const total = rows.reduce<Coverage>(
		(sum, r) => ({ known: sum.known + r.known, learning: sum.learning + r.learning, unseen: sum.unseen + r.unseen, total: sum.total + r.total }),
		{ known: 0, learning: 0, unseen: 0, total: 0 }
	);
	const quota = allocate(
		pools.map((p) => p.length),
		config.sampleSize ?? SAMPLE_SIZE
	);
	const sample: number[] = [];
	const sampleLevel: number[] = [];
	pools.forEach((pool, l) => {
		const [picks] = pick(pool.length, quota[l], (config.seed + Math.imul(l + 1, 0x9e3779b1)) >>> 0);
		for (const i of picks) {
			sample.push(pool[i]);
			sampleLevel.push(l);
		}
	});
	return { levels: rows, total, sample, sampleLevel };
}

/** Wilson score interval of `yes` of `n`, 90 %. */
function wilson(yes: number, n: number): [number, number] {
	const p = yes / n;
	const z2 = Z * Z;
	const denom = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denom;
	const half = (Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
	return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function band(share: number): Readiness {
	if (share >= READY_SHARE) return 'ready';
	if (share >= 0.7) return 'close';
	if (share >= 0.4) return 'partway';
	return 'early';
}

/** checkEstimate: readiness from the plan and the answers to its sample (true = "I know it"), in order. */
export function checkEstimate(plan: CheckPlan, answers: readonly boolean[]): CheckEstimate {
	const asked = Math.min(answers.length, plan.sample.length);
	const yes = answers.slice(0, asked).filter(Boolean).length;
	const levelAsked = plan.levels.map(() => 0);
	const levelYes = plan.levels.map(() => 0);
	for (let i = 0; i < asked; i++) {
		levelAsked[plan.sampleLevel[i]] += 1;
		if (answers[i]) levelYes[plan.sampleLevel[i]] += 1;
	}
	const pooled = asked > 0 ? yes / asked : 0;
	const [pooledLow, pooledHigh] = asked > 0 ? wilson(yes, asked) : [0, 0];
	const perLevel: LevelEstimate[] = plan.levels.map((l, i) => {
		const rest = l.total - l.known;
		const n = levelAsked[i];
		const exact = rest === 0 || n >= rest;
		const own = !exact && n >= MIN_LEVEL_ANSWERS;
		const ownRate = n > 0 ? levelYes[i] / n : 0;
		const rate = exact || own ? ownRate : pooled;
		let [lo, hi]: [number, number] = exact ? [rate, rate] : own ? wilson(levelYes[i], n) : [pooledLow, pooledHigh];
		// "Not sure" to everything is no evidence of knowing: the range starts at the data alone.
		if (!exact && rate === 0) lo = 0;
		const at = (r: number): number => (l.total === 0 ? 0 : (l.known + r * rest) / l.total);
		return { name: l.name, share: at(rate), low: at(lo), high: at(hi), asked: n, exact, pooled: !exact && !own };
	});
	const weighted = (value: (l: LevelEstimate) => number): number =>
		plan.total.total === 0 ? 0 : perLevel.reduce((acc, l, i) => acc + value(l) * plan.levels[i].total, 0) / plan.total.total;
	const share = weighted((l) => l.share);
	const first = perLevel.findIndex((l) => l.share < READY_SHARE);
	return {
		asked,
		yes,
		share,
		low: weighted((l) => l.low),
		high: weighted((l) => l.high),
		exact: perLevel.every((l) => l.exact),
		band: band(share),
		perLevel,
		next: first < 0 ? null : { position: first + 1, name: perLevel[first].name }
	};
}
