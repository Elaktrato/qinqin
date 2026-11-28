// What the Practice list shows of a drill, and the rounds: the core's picks (lib/studycore/drills.ts) over the items
// the drills give.

import { isDrillDue, pickRound, pickWeakest, stateOf, type DrillStates } from '$lib/studycore/drills';
import type { StudyClock } from '$lib/studycore/studyClock';
import type { DrillItem, RoundEntry } from './types';

export interface DrillSummary {
	/** The drill's candidate items. */
	total: number;
	/** Items with an answer whose schedule is due. */
	due: number;
	/** Items with at least one answer. */
	seen: number;
	/** Items never answered. */
	fresh: number;
}

/** drillSummary counts a drill's candidate items by their state at `now`. */
export function drillSummary(drill: string, items: readonly string[], states: DrillStates, now: number): DrillSummary {
	const out: DrillSummary = { total: 0, due: 0, seen: 0, fresh: 0 };
	for (const key of new Set(items)) {
		out.total++;
		const s = stateOf(states, drill, key);
		if (s === undefined) {
			out.fresh++;
			continue;
		}
		out.seen++;
		if (isDrillDue(s, now)) out.due++;
	}
	return out;
}

function byKey(items: readonly DrillItem[]): Map<string, DrillItem> {
	const map = new Map<string, DrillItem>();
	for (const item of items) if (!map.has(item.key)) map.set(item.key, item);
	return map;
}

/** roundOf: a drill's round (due, new, ahead; pick.json `round`) as entries with the drill's items. */
export function roundOf(drill: string, items: readonly DrillItem[], states: DrillStates, now: number, clock: StudyClock): RoundEntry[] {
	const map = byKey(items);
	return pickRound(drill, [...map.keys()], states, now, clock).map(({ item }) => ({ drill, item: map.get(item)! }));
}

/** weakestRound: the practise-weakest round across the drills that apply (pick.json `weakest`). */
export function weakestRound(
	drills: readonly { drill: string; items: readonly DrillItem[] }[],
	states: DrillStates,
	now: number,
	clock: StudyClock
): RoundEntry[] {
	const maps = new Map(drills.map((d) => [d.drill, byKey(d.items)]));
	const picked = pickWeakest(
		drills.map((d) => ({ drill: d.drill, items: [...maps.get(d.drill)!.keys()] })),
		states,
		now,
		clock
	);
	return picked.map(({ drill, item }) => ({ drill, item: maps.get(drill)!.get(item)! }));
}
