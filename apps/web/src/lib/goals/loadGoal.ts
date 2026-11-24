// The one I/O of daily goals: a workspace's study history (goal row,
// reviews, vacations, limits; cached and shared, study/data.ts loadStudyHistory) plus one
// activity window of that workspace. Both rings (home widget, flashcards
// widget) call this; concurrent calls for the same workspace, learner day
// and force flag (and signed-in user) share one promise, dropped once it settles.

import { errorText } from '$lib/api/apiErrors';
import { onSessionEnd } from '../session/sessionEnd';
import { t } from '../i18n';
import { fetchActivity, type ActivityResponse, type ActivitySource } from '../api/stats';
import { loadStudyHistory } from '../study/data';
import { outboxUser } from '../study/outboxUser';
import { effectiveLimits } from '../study/limits';
import { vacationRuns } from '../study/vacation';
import { addDays } from '../time/studyDay';
import { currentStudyDay } from '../time/zone';
import { NO_AMOUNTS, activityAmounts, amountsOf, flashcardAmounts } from './amounts';
import { activityType, goalOn, metricsBetween, type GoalsRow } from './goals';
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
	/**
	 * The activity request failed (offline): days of activity:* goals are
	 * unavailable, flashcards:* goals are still computed from the local log.
	 */
	activityError: string | null;
}

const inflight = new Map<string, Promise<GoalView>>();
onSessionEnd(() => inflight.clear());

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
			limitsNew,
			activityError: null
		};
	}
	const withStreak = parsed.showStreak && goalOn(parsed, today) !== null;
	const windowStart = withStreak ? addDays(today, -STREAK_WINDOW_DAYS) : today;
	// Only an activity goal needs the server; flashcards goals are counted
	// from the local log, so they keep working offline.
	const needsActivity = metricsBetween(parsed, windowStart, today).some((m) => activityType(m) !== null);
	let activity: Pick<ActivityResponse, 'sources' | 'cells'> = { sources: [], cells: [] };
	let activityError: string | null = null;
	if (needsActivity) {
		try {
			activity = await fetchActivity(windowStart, today, workspaceId);
		} catch (err) {
			activityError = errorText(err, t('goals.activityFailed'));
		}
	}
	const sources = activity.sources ?? [];
	const unitOf: UnitOf = (type) => sources.find((s) => s.type === type)?.unit ?? null;
	const of = amountsOf(flashcardAmounts(data.reviews, day.dayOf), activityAmounts(activity.cells ?? [], workspaceId));
	return {
		row: parsed,
		newer: false,
		today: goalDay(parsed, today, today, of(today), vacation, unitOf),
		streak: withStreak ? goalStreak(parsed, today, windowStart, of, vacation, unitOf) : null,
		sources,
		limitsNew,
		activityError
	};
}

export function loadGoalStatus(
	workspaceId: number,
	opts?: { force?: boolean; now?: number }
): Promise<GoalView> {
	const now = opts?.now ?? Date.now();
	const force = opts?.force === true;
	// Keyed by the signed-in user too: a load in flight never serves the next account.
	const key = `${outboxUser() ?? 0}|${workspaceId}|${currentStudyDay().today(now)}|${force ? 1 : 0}`;
	const pending = inflight.get(key);
	if (pending !== undefined) return pending;
	const promise = load(workspaceId, now, force).finally(() => {
		if (inflight.get(key) === promise) inflight.delete(key);
	});
	inflight.set(key, promise);
	return promise;
}
