// The level check (#82), pure and deterministic given a seed. Method and
// limits: docs/superpowers/specs/2026-11-26-level-check-design.md.
//
// For a target level of a scheme (HSK 4, N3 ...) the lists of that level and
// of every level below it make the vocabulary the exam can ask. What the app
// already knows about the learner is exact and needs no question: an entry is
// known, learning or unseen by the shared predicate (lib/study/known.ts). Only
// the entries the app does not call known can still be known from elsewhere,
// so a seeded sample of them is asked, self-assessed, with the placement
// test's generator (`pick`). The sampled "yes" share is assumed for every
// not-yet-known entry: readiness = (known + share * not-yet-known) / total,
// with a 90 % Wilson range for the share. No I/O, no clock, no Math.random.

import { familiarity, type KnownIndex } from '$lib/study/known';
import type { LevelMembers } from './declare';
import { pick } from './placement';

export const SAMPLE_SIZE = 20;
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
	/** The entries to ask, in order: distinct, none known by the app. */
	sample: number[];
}

export type Readiness = 'early' | 'partway' | 'close' | 'ready';

export interface CheckEstimate {
	asked: number;
	yes: number;
	/** Point estimate of the share of the range the learner knows, 0..1. */
	share: number;
	/** 90 % range of `share`; `low` is the data alone plus the lower end of the sampled share. */
	low: number;
	high: number;
	band: Readiness;
	perLevel: { name: string; share: number }[];
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

/** planCheck: the coverage by the learner's data and the sample to ask. */
export function planCheck(config: PlanConfig): CheckPlan {
	const { levels, target, index } = config;
	if (!Number.isInteger(target) || target < 1 || target > levels.length) throw new Error('level check: target outside the levels');
	const seen = new Set<number>();
	const pool: number[] = [];
	const rows: LevelCoverage[] = [];
	for (const level of levels.slice(0, target)) {
		const row: LevelCoverage = { name: level.name, known: 0, learning: 0, unseen: 0, total: 0 };
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
		rows.push(row);
	}
	const total = rows.reduce<Coverage>(
		(sum, r) => ({ known: sum.known + r.known, learning: sum.learning + r.learning, unseen: sum.unseen + r.unseen, total: sum.total + r.total }),
		{ known: 0, learning: 0, unseen: 0, total: 0 }
	);
	const [picks] = pick(pool.length, config.sampleSize ?? SAMPLE_SIZE, config.seed >>> 0);
	return { levels: rows, total, sample: picks.map((i) => pool[i]) };
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
	const rest = (c: Coverage): number => c.total - c.known;
	let rate = 0;
	let lowRate = 0;
	let highRate = 0;
	if (asked > 0) {
		rate = yes / asked;
		[lowRate, highRate] = wilson(yes, asked);
		// "Not sure" to everything is no evidence of knowing: the range starts at the data alone.
		if (yes === 0) lowRate = 0;
	}
	const at = (c: Coverage, r: number): number => (c.total === 0 ? 0 : (c.known + r * rest(c)) / c.total);
	const share = at(plan.total, rate);
	const perLevel = plan.levels.map((l) => ({ name: l.name, share: at(l, rate) }));
	const first = perLevel.findIndex((l) => l.share < READY_SHARE);
	return {
		asked,
		yes,
		share,
		low: at(plan.total, lowRate),
		high: at(plan.total, highRate),
		band: band(share),
		perLevel,
		next: first < 0 ? null : { position: first + 1, name: perLevel[first].name }
	};
}
