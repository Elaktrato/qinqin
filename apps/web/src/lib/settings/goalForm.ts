// Settings → Study → Daily goal: the form's view model. Pure; the row rules
// are lib/goals/goals.ts (planGoalEdit), the metric list goalText.ts.

import {
	MAX_COUNT_TARGET,
	MAX_MINUTES_TARGET,
	goalOn,
	planGoalEdit,
	type GoalEdit,
	type GoalMetric,
	type GoalsRow
} from '$lib/goals/goals';
import type { MetricOption } from '$lib/goals/goalText';

export interface GoalFormState {
	/** '' = no daily goal. */
	metric: GoalMetric | '';
	target: string;
	showStreak: boolean;
}

/** formFrom: the goal in effect today and the streak switch. */
export function formFrom(row: GoalsRow | null, today: string): GoalFormState {
	const goal = goalOn(row, today);
	return {
		metric: goal?.metric ?? '',
		target: goal === null ? '' : String(goal.target),
		showStreak: row?.showStreak ?? true
	};
}

export function rangeError(unit: 'count' | 'minutes'): string {
	return unit === 'minutes'
		? `Enter a whole number of minutes from 1 to ${MAX_MINUTES_TARGET}`
		: `Enter a whole number from 1 to ${MAX_COUNT_TARGET}`;
}

function wholeNumber(text: string): number | null {
	const trimmed = text.trim();
	return /^\d+$/.test(trimmed) ? Number(trimmed) : null;
}

export function validateForm(
	s: GoalFormState,
	options: readonly MetricOption[]
): { edit: GoalEdit } | { error: string } {
	if (s.metric === '') return { edit: null };
	const option = options.find((o) => o.metric === s.metric);
	if (option === undefined) return { error: 'Choose what to count' };
	const max = option.unit === 'minutes' ? MAX_MINUTES_TARGET : MAX_COUNT_TARGET;
	const target = wholeNumber(s.target);
	if (target === null || target < 1 || target > max) return { error: rangeError(option.unit) };
	return { edit: { metric: s.metric, target } };
}

/** limitHint: a new-card target the workspace's daily limit cannot admit. */
export function limitHint(s: GoalFormState, newLimit: number | null): string | null {
	if (s.metric !== 'flashcards:new' || newLimit === null) return null;
	const target = wholeNumber(s.target);
	if (target === null || target <= newLimit) return null;
	return `Your daily new-card limit is ${newLimit}; raise it to reach this goal`;
}

/**
 * planForm: the one row Save writes (goal and streak switch together), null
 * when nothing changes, or the validation error.
 */
export function planForm(
	row: GoalsRow | null,
	s: GoalFormState,
	options: readonly MetricOption[],
	today: string
): { row: GoalsRow | null } | { error: string } {
	const checked = validateForm(s, options);
	if ('error' in checked) return checked;
	const withGoal = planGoalEdit(row, checked.edit, today);
	const base = withGoal ?? row;
	const withStreak = planGoalEdit(base, { showStreak: s.showStreak }, today);
	return { row: withStreak ?? withGoal };
}
