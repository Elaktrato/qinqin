// The week of a learner date: Monday to Sunday by civil date, its window of
// instants and the URL parameter of the week shown. Pure.
// Rule and fixtures: docs/contracts/weekly/.

import { addDays, daysBetweenDates, isDay, type StudyDay } from '../time/studyDay';

/** Completed weeks before the current one that can be browsed. */
export const MAX_WEEKS_BACK = 52;

export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A Monday of the proleptic Gregorian calendar, the anchor of isoWeekday. */
const A_MONDAY = '1970-01-05';

/** isoWeekday: 1 = Monday … 7 = Sunday, from the civil date (never an instant). */
export function isoWeekday(day: string): IsoWeekday {
	if (!isDay(day)) throw new RangeError(`not a day: ${day}`);
	// Civil-day distance from a known Monday (studyDay's date arithmetic).
	return ((((daysBetweenDates(A_MONDAY, day) % 7) + 7) % 7) + 1) as IsoWeekday;
}

/** weekOf: the Monday of the week holding `day`. */
export function weekOf(day: string): string {
	return addDays(day, 1 - isoWeekday(day));
}

/** weekDates: the seven dates Monday … Sunday. */
export function weekDates(monday: string): string[] {
	return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export interface WeekWindow {
	monday: string;
	/** dayStart(Monday), epoch ms. */
	start: number;
	/** dayStart(next Monday), epoch ms; the window is [start, end). */
	end: number;
}

export function weekWindow(monday: string, day: StudyDay): WeekWindow {
	return { monday, start: day.dayStart(monday), end: day.dayStart(addDays(monday, 7)) };
}

/** isSkippedDate: the date never happened for the learner (an empty window). */
export function isSkippedDate(date: string, day: StudyDay): boolean {
	return day.dayStart(date) === day.dayStart(addDays(date, 1));
}

/** oldestWeek: the Monday MAX_WEEKS_BACK weeks before the current one. */
export function oldestWeek(today: string): string {
	return addDays(weekOf(today), -7 * MAX_WEEKS_BACK);
}

/** normalizeWeekParam: the Monday a `?week=` value shows, within the cap. */
export function normalizeWeekParam(param: string | null, today: string): string {
	const current = weekOf(today);
	if (param === null || !isDay(param)) return current;
	const monday = weekOf(param);
	if (monday > current) return current;
	const oldest = oldestWeek(today);
	return monday < oldest ? oldest : monday;
}

export function previousWeek(monday: string): string {
	return addDays(monday, -7);
}

/** nextWeek: the following Monday, null on (or after) the current week. */
export function nextWeek(monday: string, today: string): string | null {
	const next = addDays(monday, 7);
	return next > weekOf(today) ? null : next;
}

const WEEK_PATH = '/stats/week';

/** weekHref: the Week tab's link for a Monday (the current week has no parameter). */
export function weekHref(monday: string, today: string): string {
	return monday === weekOf(today) ? WEEK_PATH : `${WEEK_PATH}?week=${monday}`;
}

/** weekRedirect: the link to replace the URL with when `?week=` is not the week shown; null when it is. */
export function weekRedirect(param: string | null, today: string): string | null {
	if (param === null) return null;
	const monday = normalizeWeekParam(param, today);
	const href = weekHref(monday, today);
	return param === monday && href !== WEEK_PATH ? null : href;
}

/** hasPreviousWeek: a week before `monday` is still within the cap. */
export function hasPreviousWeek(monday: string, today: string): boolean {
	return previousWeek(monday) >= oldestWeek(today);
}
