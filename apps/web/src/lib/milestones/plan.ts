// What the milestones show: the card plan (none / recent / summary), the
// history list and the week's items. Pure.
// Rule and fixtures: docs/contracts/milestones/ (show-plan.json).

import { addDays, isDay, type StudyDay } from '$lib/time/studyDay';
import { compareIds, parseMilestoneId } from './catalogue';
import type { Reached } from './reached';
import type { SeenMilestone } from './seen';

export type CardPlan =
	| { kind: 'none' }
	| { kind: 'recent'; items: Reached[]; ids: string[] }
	| { kind: 'summary'; count: number; named: Reached[]; more: number; ids: string[] };

/** At most this many recent milestones are named one by one. */
const RECENT_MAX = 3;
/** Recent: reached on today − 6 or later. */
const RECENT_DAYS = 6;

/** unseenReached: the reached milestones not seen, newest first (ties in catalogue order). */
export function unseenReached(reached: readonly Reached[], seen: ReadonlySet<string>): Reached[] {
	return reached.filter((r) => !seen.has(r.id)).sort((a, b) => b.at - a.at || compareIds(a.id, b.id));
}

/**
 * milestoneCard: one card for every unseen milestone. `ids` is what a
 * dismiss marks: every unseen id, never only the named ones.
 */
export function milestoneCard(unseen: readonly Reached[], today: string): CardPlan {
	if (unseen.length === 0) return { kind: 'none' };
	const ids = unseen.map((r) => r.id);
	const since = addDays(today, -RECENT_DAYS);
	if (unseen.length <= RECENT_MAX && unseen.every((r) => r.day >= since)) {
		return { kind: 'recent', items: [...unseen], ids };
	}
	const named = unseen.slice(0, RECENT_MAX);
	return { kind: 'summary', count: unseen.length, named, more: unseen.length - named.length, ids };
}

export interface HistoryItem {
	id: string;
	day: string;
	isNew: boolean;
}

/**
 * milestoneHistory: every seen milestone (live rows, then pending) and every
 * unseen reached one ("New"). A seen item's day is its stored reachedDay,
 * else the derived day, else seenAt's learner day, else it is left out.
 * Ids this client does not know are left out. Newest day first, then
 * catalogue order.
 */
export function milestoneHistory(
	reached: readonly Reached[],
	live: ReadonlyMap<string, SeenMilestone>,
	pending: readonly SeenMilestone[],
	day: StudyDay
): HistoryItem[] {
	const derived = new Map(reached.map((r) => [r.id, r.day]));
	const seen = new Map(live);
	for (const m of pending) if (!seen.has(m.id)) seen.set(m.id, m);
	const items: HistoryItem[] = [];
	for (const m of seen.values()) {
		if (parseMilestoneId(m.id) === null) continue;
		let date = m.reachedDay ?? derived.get(m.id) ?? null;
		if (date === null && m.seenAt !== null) {
			const at = Date.parse(m.seenAt);
			if (!Number.isNaN(at)) date = day.dayOf(at);
		}
		if (date === null || !isDay(date)) continue;
		items.push({ id: m.id, day: date, isNew: false });
	}
	for (const r of reached) {
		if (seen.has(r.id) || parseMilestoneId(r.id) === null) continue;
		items.push({ id: r.id, day: r.day, isNew: true });
	}
	return items.sort((a, b) => (a.day > b.day ? -1 : a.day < b.day ? 1 : compareIds(a.id, b.id)));
}

/** milestonesInWeek: the history items dated monday … monday + 6 (civil dates). */
export function milestonesInWeek(history: readonly HistoryItem[], monday: string): HistoryItem[] {
	const sunday = addDays(monday, 6);
	return history.filter((item) => item.day >= monday && item.day <= sunday);
}
