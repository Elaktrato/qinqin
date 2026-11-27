// The summary of one week of one workspace: the count rows with their
// comparison, the seven days, days active, the streak, goal days and the
// mature / character crossings (given as callbacks over two cutoffs).
// Pure. Rule and fixtures: docs/contracts/weekly/.

import type { ActivityCell, ActivitySource } from '../api/stats';
import { activityAmounts, amountsOf, flashcardAmounts, type FlashcardDay } from '../goals/amounts';
import type { GoalsRow } from '../goals/goals';
import { goalDays, type UnitOf } from '../goals/progress';
import { dailyStreak } from '$lib/studycore/exp';
import type { GrammarRun } from '$lib/studycore/grammarRuns';
import { isValidReview } from '$lib/studycore/scheduler';
import type { ReviewEvent } from '$lib/studycore/types';
import { isVacationDay, type Run } from '$lib/studycore/vacation';
import { addDays, type StudyDay } from '../time/studyDay';
import { reviewsKey } from './replay';
import { isSkippedDate, isoWeekday, weekDates, weekOf } from './week';
import { activityLabel } from '../activity/sources';

export type DayState = 'active' | 'inactive' | 'vacation' | 'upcoming' | 'skipped';

export interface WeekDay {
	date: string;
	state: DayState;
	/** The `review` cell's raw; null offline or upcoming. */
	reviews: number | null;
	/** All points of the workspace on the date; null offline or upcoming. */
	points: number | null;
}

export type RowKey = 'reviews' | 'newCards' | 'studyTime' | 'reading' | 'journal' | `activity:${string}`;

export interface CountRow {
	key: RowKey;
	/** null = the activity route is unavailable (offline). */
	value: number | null;
	previous: number | null;
	unit: 'count' | 'seconds';
}

export interface Pair {
	value: number;
	previous: number;
}

export interface WeekSummary {
	monday: string;
	today: string;
	inProgress: boolean;
	/** The last date of the comparison window. */
	compareThrough: string;
	rows: CountRow[];
	days: WeekDay[];
	/** The seven days of the week before (Monday … Sunday), same rules; never upcoming. */
	previousDays: WeekDay[];
	daysActive: { active: number; of: number; localOnly: boolean };
	streak: number;
	mature: Pair | null;
	characters: Pair | null;
	goal: { met: number; of: number } | null;
	allVacation: boolean;
	nothingToCompare: boolean;
}

export interface WeekInputs {
	monday: string;
	now: number;
	day: StudyDay;
	workspaceId: number;
	reviews: readonly ReviewEvent[];
	/** The workspace's grammar lesson runs: they keep the streak (#277). */
	grammarRuns?: readonly GrammarRun[];
	vacation: readonly Run[];
	/** null = the activity request failed (offline). */
	activity: { cells: readonly ActivityCell[]; sources: readonly ActivitySource[] } | null;
	goals: GoalsRow | null;
	/** Words reaching mature between two cutoffs (epoch ms); absent = not shown. */
	mature?: (before: number, after: number) => number;
	/** Characters learned between two cutoffs; absent = not shown (not Han, or not loaded). */
	characters?: (before: number, after: number) => number;
}

const REVIEW = 'review';
const READ = 'read';
const JOURNAL = 'journal';
const BUILT_IN_TYPES = new Set([REVIEW, READ, JOURNAL]);

function datesBetween(from: string, to: string): string[] {
	const out: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
	return out;
}

export interface WeekCutoffs {
	/** [end of Monday − 1, end of the last counted date] (epoch ms). */
	week: [number, number];
	/** The same for the comparison window. */
	previous: [number, number];
}

/**
 * weekCutoffs: the replay cutoffs of a week and its comparison window.
 * "The end of day D" is the instant dayStart(D + 1); the state before
 * the week is the end of Monday − 1, i.e. dayStart(Monday).
 */
export function weekCutoffs(monday: string, today: string, day: StudyDay): WeekCutoffs {
	const sunday = addDays(monday, 6);
	const last = sunday < today ? sunday : today;
	const compareThrough = monday === weekOf(today) ? addDays(today, -7) : addDays(monday, -1);
	const end = (d: string): number => day.dayStart(addDays(d, 1));
	return {
		week: [day.dayStart(monday), end(last)],
		previous: [day.dayStart(addDays(monday, -7)), end(compareThrough)]
	};
}

export interface LocalPass {
	flash: Map<string, FlashcardDay>;
	/** Learner days with a valid local review. */
	localDays: Set<string>;
}

/** Counts passes over the review log; the performance test reads it. */
export const summaryStats = { logPasses: 0 };

// The per-day pass over the review log, once per log content (reviewsKey:
// a history reloaded after its TTL is a new, equal array) and study day
// (a cached object), so browsing weeks does not repeat it.
const MAX_PASSES = 4;

/** The session's passes (context/caches.ts), by log content. */
export type WeekPasses = Map<string, { day: StudyDay; pass: LocalPass }>;

function localPass(passes: WeekPasses, reviews: readonly ReviewEvent[], day: StudyDay): LocalPass {
	const key = reviewsKey(reviews);
	const hit = passes.get(key);
	if (hit !== undefined && hit.day === day) return hit.pass;
	summaryStats.logPasses += 1;
	const pass = {
		flash: flashcardAmounts(reviews, day.dayOf),
		localDays: new Set(reviews.filter(isValidReview).map((r) => day.dayOf(Date.parse(r.ts))))
	};
	passes.delete(key);
	if (passes.size >= MAX_PASSES) passes.delete(passes.keys().next().value as string);
	passes.set(key, { day, pass });
	return pass;
}

export function weekSummary(passes: WeekPasses, input: WeekInputs): WeekSummary {
	const { monday, day, workspaceId, reviews, vacation, activity } = input;
	const today = day.today(input.now);
	if (isoWeekday(monday) !== 1) throw new RangeError(`weekSummary: ${monday} is not a Monday`);
	const current = weekOf(today);
	if (monday > current) throw new RangeError(`weekSummary: ${monday} is after the current week`);
	const inProgress = monday === current;
	const dates = weekDates(monday);
	const sunday = dates[6];
	const last = sunday < today ? sunday : today;
	const prevMonday = addDays(monday, -7);
	const compareThrough = inProgress ? addDays(today, -7) : addDays(monday, -1);
	const week = datesBetween(monday, last);
	const prev = datesBetween(prevMonday, compareThrough);

	const { flash, localDays } = localPass(passes, reviews, day);
	const act = activity === null ? null : activityAmounts(activity.cells, workspaceId);
	const points = new Map<string, number>();
	for (const cell of activity?.cells ?? []) {
		if (cell.workspace !== workspaceId || typeof cell.points !== 'number' || !Number.isFinite(cell.points)) continue;
		points.set(cell.day, (points.get(cell.day) ?? 0) + cell.points);
	}

	const sumFlash = (range: string[], field: keyof FlashcardDay): number =>
		range.reduce((n, d) => n + (flash.get(d)?.[field] ?? 0), 0);
	const sumAct = (range: string[], type: string): number | null =>
		act === null ? null : range.reduce((n, d) => n + (act.get(d)?.[type] ?? 0), 0);
	const activityRow = (key: RowKey, type: string, unit: CountRow['unit']): CountRow => ({
		key,
		value: sumAct(week, type),
		previous: sumAct(prev, type),
		unit
	});

	const others = (activity?.sources ?? [])
		.filter((s) => !BUILT_IN_TYPES.has(s.type))
		.sort((a, b) => activityLabel(a).localeCompare(activityLabel(b)) || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0))
		.map((s) => activityRow(`activity:${s.type}`, s.type, s.unit))
		.filter((row) => (row.value ?? 0) > 0 || (row.previous ?? 0) > 0);

	const rows: CountRow[] = [
		activityRow('reviews', REVIEW, 'count'),
		{ key: 'newCards', value: sumFlash(week, 'newCards'), previous: sumFlash(prev, 'newCards'), unit: 'count' },
		{ key: 'studyTime', value: sumFlash(week, 'studySeconds'), previous: sumFlash(prev, 'studySeconds'), unit: 'seconds' },
		activityRow('reading', READ, 'seconds'),
		activityRow('journal', JOURNAL, 'count'),
		...others
	];

	const dayEntry = (date: string): WeekDay => {
		if (date > today) return { date, state: 'upcoming', reviews: null, points: null };
		const reviewsOf = act === null ? null : (act.get(date)?.[REVIEW] ?? 0);
		const pointsOf = act === null ? null : (points.get(date) ?? 0);
		let state: DayState;
		if (isSkippedDate(date, day)) state = 'skipped';
		else if (isVacationDay(vacation, date)) state = 'vacation';
		else if ((pointsOf ?? 0) > 0 || localDays.has(date)) state = 'active';
		else state = 'inactive';
		return { date, state, reviews: reviewsOf, points: pointsOf };
	};

	const days: WeekDay[] = dates.map(dayEntry);
	// The paired bars cover all seven days of the week before, even where
	// the four numbers stop at the same weekday (contract ruling).
	const previousDays: WeekDay[] = datesBetween(prevMonday, addDays(prevMonday, 6)).map(dayEntry);
	// Today counts once something is done: an empty morning is not a miss.
	const counted = days.filter(
		(d) =>
			d.state !== 'upcoming' &&
			d.state !== 'vacation' &&
			d.state !== 'skipped' &&
			!(d.date === today && d.state === 'inactive')
	);

	const end = inProgress ? input.now : day.dayStart(addDays(sunday, 1)) - 1;
	const streak = dailyStreak(
		reviews,
		end,
		day,
		vacation,
		(input.grammarRuns ?? []).filter((run) => run.workspaceId === workspaceId)
	).current;

	const cuts = weekCutoffs(monday, today, day);
	const pair = (f: ((before: number, after: number) => number) | undefined): Pair | null =>
		f === undefined ? null : { value: f(...cuts.week), previous: f(...cuts.previous) };

	const nothingToCompare =
		!prev.some((d) => localDays.has(d)) &&
		!(activity?.cells ?? []).some(
			(c) => c.workspace === workspaceId && prev.includes(c.day) && (c.points > 0 || c.raw > 0)
		);

	return {
		monday,
		today,
		inProgress,
		compareThrough,
		rows,
		days,
		previousDays,
		daysActive: { active: counted.filter((d) => d.state === 'active').length, of: counted.length, localOnly: act === null },
		streak,
		mature: pair(input.mature),
		characters: pair(input.characters),
		goal: goalLine(input, week, today, flash, act, days),
		allVacation: days.some((d) => d.state === 'vacation') && days.every((d) => d.state === 'vacation' || d.state === 'skipped'),
		nothingToCompare
	};
}

function goalLine(
	input: WeekInputs,
	week: string[],
	today: string,
	flash: Map<string, FlashcardDay>,
	act: Map<string, Record<string, number>> | null,
	days: WeekDay[]
): WeekSummary['goal'] {
	const row = input.goals;
	if (row === null || week.length === 0) return null;
	const sources = input.activity?.sources ?? [];
	const unitOf: UnitOf = (type) => sources.find((s) => s.type === type)?.unit ?? null;
	// Offline an activity goal's days are unavailable (no source units) and left out.
	const of = amountsOf(flash, act ?? new Map());
	const list = goalDays(row, week[0], week[week.length - 1], today, of, input.vacation, unitOf);
	if (list.every((g) => g.metric === null)) return null;
	const skipped = new Set(days.filter((d) => d.state === 'skipped').map((d) => d.date));
	const kept = list.filter((g) => !skipped.has(g.day));
	const met = kept.filter((g) => g.status === 'met').length;
	return { met, of: met + kept.filter((g) => g.status === 'missed').length };
}
