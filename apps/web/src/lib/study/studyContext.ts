// What every queue, count and preview needs to know about "now" for one
// workspace: the learner's day, the study clock (vacation days removed) and
// whether today is a vacation day. Built by history.ts; rebuilt when the
// date changes. Required everywhere (no silent default outside tests).

import { IDENTITY_CLOCK, type StudyClock } from './studyClock';
import { studyDay, type StudyDay, type ZoneChange } from '../time/studyDay';
import type { Schedule } from './scheduler';
import { studyClock } from './studyClock';
import type { LimitPair } from './limits';
import { isVacationDay, type Run } from './vacation';

/** The workspace's limit rows and which decks exist (docs/contracts/scheduler/). */
export interface LimitRows {
	workspace: Partial<LimitPair> | null;
	decks: Readonly<Record<string, Partial<LimitPair>>>;
	/** The ids of the decks that exist (general included); null: every deck id counts as existing. */
	existingDecks: ReadonlySet<string> | null;
}

export const NO_LIMIT_ROWS: LimitRows = { workspace: null, decks: {}, existingDecks: null };

export interface StudyContext {
	day: StudyDay;
	clock: StudyClock;
	vacationToday: boolean;
	/** The workspace's vacation runs (learner dates), for streaks and marks. */
	vacation: readonly Run[];
	/** Daily limit rows; the defaults apply to a workspace without them. */
	limits: LimitRows;
	/** The zone history `day` was built from (a worker rebuilds the context from it). */
	history: readonly ZoneChange[];
}

/** UTC day, identity clock, no vacation: for tests only (a guard test greps src). */
export const UTC_CONTEXT: StudyContext = {
	day: studyDay([]),
	clock: IDENTITY_CLOCK,
	vacationToday: false,
	vacation: [],
	limits: NO_LIMIT_ROWS,
	history: []
};

/** A card is due when its instant has come and today is not a vacation day. */
export function isDueNow(schedule: Schedule, now: Date, ctx: StudyContext): boolean {
	if (ctx.vacationToday) return false;
	const due = Date.parse(schedule.due);
	return (Number.isNaN(due) ? 0 : due) <= now.getTime();
}

/** contextFor builds the context of one workspace from its vacation runs. */
// `history` must be the zone history `day` was built from (currentStudyHistory()).

export function contextFor(
	day: StudyDay,
	runs: readonly Run[] = [],
	now: number = Date.now(),
	history: readonly ZoneChange[] = [],
	limits: LimitRows = NO_LIMIT_ROWS
): StudyContext {
	return {
		history,
		day,
		clock: studyClock(runs, day),
		vacationToday: isVacationDay(runs, day.today(now)),
		vacation: runs,
		limits
	};
}
