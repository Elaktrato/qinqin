// The goal and its status on a learner day, a range of days (the weekly
// summary reuses goalDays) and the vacation-neutral goal streak. Pure.
// Rule and fixtures: docs/contracts/goals/.

import { isVacationDay, type Run } from '$lib/studycore/vacation';
import { addDays } from '../time/studyDay';
import type { DayAmounts } from './amounts';
import { activityType, goalOn, type GoalMetric, type GoalsRow } from './goals';

export type GoalStatus = 'none' | 'vacation' | 'met' | 'open' | 'missed';

/** The unit of an activity source; null when the type is not in the route's sources. */
export type UnitOf = (activityType: string) => 'count' | 'seconds' | null;

export interface GoalDay {
	day: string;
	status: GoalStatus;
	metric: GoalMetric | null;
	target: number | null;
	/** In display units: count, or whole minutes (floor). */
	amount: number;
	/** 0…1, capped; 0 for none/vacation. */
	fraction: number;
	/** The goal's activity type is not a current source (the day counts as none). */
	unavailable: boolean;
}

export interface GoalStreak {
	current: number;
	todayMet: boolean;
	/** The run reaches back past the window's first day: at least `current`. */
	capped: boolean;
}

/** The raw amount of a metric and whether it is measured in seconds; null when unavailable. */
function measure(
	metric: GoalMetric,
	amounts: DayAmounts,
	unitOf: UnitOf
): { raw: number; seconds: boolean } | null {
	if (metric === 'flashcards:new') return { raw: amounts.newCards, seconds: false };
	if (metric === 'flashcards:studyTime') return { raw: amounts.studySeconds, seconds: true };
	const type = activityType(metric)!;
	const unit = unitOf(type);
	if (unit === null) return null;
	return { raw: amounts.activity[type] ?? 0, seconds: unit === 'seconds' };
}

export function goalDay(
	row: GoalsRow | null,
	day: string,
	today: string,
	amounts: DayAmounts,
	vacation: readonly Run[],
	unitOf: UnitOf
): GoalDay {
	if (day > today) throw new RangeError(`goalDay: ${day} is after today (${today})`);
	const goal = goalOn(row, day);
	const none: GoalDay = {
		day,
		status: 'none',
		metric: null,
		target: null,
		amount: 0,
		fraction: 0,
		unavailable: false
	};
	if (goal === null) return none;
	const m = measure(goal.metric, amounts, unitOf);
	if (m === null) return { ...none, metric: goal.metric, target: goal.target, unavailable: true };
	const needed = m.seconds ? goal.target * 60 : goal.target;
	const amount = m.seconds ? Math.floor(m.raw / 60) : m.raw;
	const base = { day, metric: goal.metric, target: goal.target, amount, unavailable: false };
	if (isVacationDay(vacation, day)) return { ...base, status: 'vacation', fraction: 0 };
	const met = m.raw >= needed;
	return {
		...base,
		status: met ? 'met' : day === today ? 'open' : 'missed',
		fraction: Math.min(1, Math.max(0, m.raw / needed))
	};
}

/** goalDays: goalDay for every learner day from..to (inclusive); [] when from > to. */
export function goalDays(
	row: GoalsRow | null,
	from: string,
	to: string,
	today: string,
	amountsOf: (day: string) => DayAmounts,
	vacation: readonly Run[],
	unitOf: UnitOf
): GoalDay[] {
	const out: GoalDay[] = [];
	for (let day = from; day <= to; day = addDays(day, 1)) {
		out.push(goalDay(row, day, today, amountsOf(day), vacation, unitOf));
	}
	return out;
}

/**
 * goalStreak counts consecutive met days ending today, or yesterday while
 * today is open; vacation days are skipped, none and missed break. The walk
 * stops at `windowStart` (normally today - 365).
 */
export function goalStreak(
	row: GoalsRow | null,
	today: string,
	windowStart: string,
	amountsOf: (day: string) => DayAmounts,
	vacation: readonly Run[],
	unitOf: UnitOf
): GoalStreak {
	const first = goalDay(row, today, today, amountsOf(today), vacation, unitOf);
	const todayMet = first.status === 'met' || first.status === 'vacation';
	if (first.status === 'none') return { current: 0, todayMet, capped: false };
	let current = first.status === 'met' ? 1 : 0;
	for (let day = addDays(today, -1); day >= windowStart; day = addDays(day, -1)) {
		const status = goalDay(row, day, today, amountsOf(day), vacation, unitOf).status;
		if (status === 'vacation') continue;
		if (status !== 'met') return { current, todayMet, capped: false };
		current++;
	}
	return { current, todayMet, capped: current > 0 };
}
