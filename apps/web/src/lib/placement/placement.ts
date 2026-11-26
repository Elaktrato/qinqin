// The adaptive placement test (#74), pure and deterministic given a seed.
//
// The learner meets items of the levels of one scheme (level 1 = the first,
// easiest). A probe asks up to PROBE_SIZE random items of one level and the
// level passes when PASS_RATIO of them are known; a probe stops as soon as it
// is decided. Levels are searched by bisection: the middle of the open range
// is probed, a pass moves the lower bound up, a fail the upper bound down. The
// placed level is the highest level passed (0 = none). No I/O, no clock, no
// Math.random: the seed fixes every item. Design:
// docs/superpowers/specs/2026-11-26-placement-design.md.

export const PROBE_SIZE = 4;
export const PASS_RATIO = 0.75;

export interface PlacementConfig {
	/** Items per level, level 1 first; every level has at least one. */
	counts: readonly number[];
	seed: number;
}

interface Probe {
	level: number;
	/** The item indexes this probe asks, in order. */
	picks: readonly number[];
	known: number;
	asked: number;
}

export interface PlacementState {
	readonly counts: readonly number[];
	/** Highest level passed so far. */
	readonly lo: number;
	/** Highest level that may still pass. */
	readonly hi: number;
	readonly rng: number;
	readonly probe: Probe | null;
	readonly log: readonly { level: number; index: number; known: boolean }[];
}

export interface PlacementItem {
	/** 1-based level. */
	level: number;
	/** Index into that level's items. */
	index: number;
}

export interface PlacementResult {
	done: boolean;
	/** The highest level passed: everything up to it is proposed as known. */
	placed: number;
	answered: number;
}

/** mulberry32 as a pure step: [value in [0,1), next state]. */
function step(state: number): [number, number] {
	const next = (state + 0x6d2b79f5) >>> 0;
	let t = next;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

export function pick(count: number, size: number, rng: number): [number[], number] {
	const pool = Array.from({ length: count }, (_, i) => i);
	const out: number[] = [];
	let state = rng;
	for (let i = 0; i < Math.min(size, count); i++) {
		const [value, next] = step(state);
		state = next;
		const at = i + Math.floor(value * (pool.length - i));
		[pool[i], pool[at]] = [pool[at], pool[i]];
		out.push(pool[i]);
	}
	return [out, state];
}

function begin(state: PlacementState): PlacementState {
	if (state.lo >= state.hi) return { ...state, probe: null };
	const level = Math.ceil((state.lo + state.hi) / 2);
	const [picks, rng] = pick(state.counts[level - 1], PROBE_SIZE, state.rng);
	return { ...state, rng, probe: { level, picks, known: 0, asked: 0 } };
}

export function startPlacement(config: PlacementConfig): PlacementState {
	for (const count of config.counts) {
		if (!Number.isInteger(count) || count < 1) throw new Error('placement: every level needs at least one item');
	}
	return begin({
		counts: config.counts,
		lo: 0,
		hi: config.counts.length,
		rng: config.seed >>> 0,
		probe: null,
		log: []
	});
}

/** currentItem: the item to show, or null when the test is finished. */
export function currentItem(state: PlacementState): PlacementItem | null {
	const probe = state.probe;
	if (probe === null) return null;
	return { level: probe.level, index: probe.picks[probe.asked] };
}

/** answer records whether the learner knew the current item; a finished test is returned unchanged. */
export function answer(state: PlacementState, known: boolean): PlacementState {
	const probe = state.probe;
	if (probe === null) return state;
	const item = { level: probe.level, index: probe.picks[probe.asked], known };
	const size = probe.picks.length;
	const need = Math.ceil(size * PASS_RATIO);
	const next = { ...probe, asked: probe.asked + 1, known: probe.known + (known ? 1 : 0) };
	const log = [...state.log, item];
	if (next.known >= need) return begin({ ...state, log, lo: probe.level, probe: null });
	if (next.asked - next.known > size - need) return begin({ ...state, log, hi: probe.level - 1, probe: null });
	return { ...state, log, probe: next };
}

export function placementResult(state: PlacementState): PlacementResult {
	return { done: state.probe === null, placed: state.lo, answered: state.log.length };
}
