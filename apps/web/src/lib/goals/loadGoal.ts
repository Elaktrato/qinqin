// The one I/O of daily goals: a workspace's study history (goal row,
// reviews, vacations, limits; cached and shared, study/history.ts) plus one
// activity window of that workspace. Both rings (home widget, flashcards
// widget) call this; concurrent calls for the same workspace, learner day
// and force flag share one promise, which is dropped once it settles.

import { fetchActivity, type ActivitySource } from '../api/stats';
import { loadStudyHistory } from '../study/history';
import { effectiveLimits } from '../study/limits';
import { vacationRuns } from '../study/vacation';
import { addDays } from '../time/studyDay';
import { currentStudyDay } from '../time/zone';
import { NO_AMOUNTS, activityAmounts, amountsOf, flashcardAmounts } from './amounts';
import { goalOn, type GoalsRow } from './goals';
import { goalDay, goalStreak, type GoalDay, type GoalStreak, type UnitOf } from './progress';

/** Days before today the goal streak looks back (the activity route's 366-day cap). */
export const STREAK_WINDOW_DAYS = 365;

export interface GoalView {
	row: GoalsRow | null;
	/** The row was written by a newer version: shown as no goal, never overwritten. */
	newer: boolean;
	today: GoalDay;
	streak: GoalStreak | null;
	sources: ActivitySource[];
	/** The workspace's effective daily new-card limit (deck overrides not considered); null = unlimited. */
	limitsNew: number | null;
}

const inflight = new Map<string, Promise<GoalView>>();

async function load(workspaceId: number, now: number, force: boolean): Promise<GoalView> {
	const day = currentStudyDay();
	const today = day.today(now);
	const data = await loadStudyHistory(workspaceId, { force });
	const parsed = data.goals ?? null;
	const limitsNew = effectiveLimits(data.limits?.workspace ?? null, null).new;
	const vacation = vacationRuns(data.vacations ?? [], workspaceId, today);
	if (parsed === null || parsed === 'newer') {
		return {
			row: null,
			newer: parsed === 'newer',
			today: goalDay(null, today, today, NO_AMOUNTS, vacation, () => null),
			streak: null,
			sources: [],
			limitsNew
		};
	}
	const withStreak = parsed.showStreak && goalOn(parsed, today) !== null;
	const windowStart = withStreak ? addDays(today, -STREAK_WINDOW_DAYS) : today;
	const activity = await fetchActivity(windowStart, today, workspaceId);
	const sources = activity.sources ?? [];
	const unitOf: UnitOf = (type) => sources.find((s) => s.type === type)?.unit ?? null;
	const of = amountsOf(flashcardAmounts(data.reviews, day.dayOf), activityAmounts(activity.cells ?? [], workspaceId));
	return {
		row: parsed,
		newer: false,
		today: goalDay(parsed, today, today, of(today), vacation, unitOf),
		streak: withStreak ? goalStreak(parsed, today, windowStart, of, vacation, unitOf) : null,
		sources,
		limitsNew
	};
}

export function loadGoalStatus(
	workspaceId: number,
	opts?: { force?: boolean; now?: number }
): Promise<GoalView> {
	const now = opts?.now ?? Date.now();
	const force = opts?.force === true;
	const key = `${workspaceId}|${currentStudyDay().today(now)}|${force ? 1 : 0}`;
	const pending = inflight.get(key);
	if (pending !== undefined) return pending;
	const promise = load(workspaceId, now, force).finally(() => {
		if (inflight.get(key) === promise) inflight.delete(key);
	});
	inflight.set(key, promise);
	return promise;
}
