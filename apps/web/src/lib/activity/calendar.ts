// Calendar helpers for the heatmap's Month and This week layouts. Pure
// civil-date arithmetic on learner days (`YYYY-MM-DD`, lib/time/studyDay):
// no device clock, no local-time getters. Weeks start on Monday.

import { addDays, daysBetweenDates } from '../time/studyDay';

/** A month as `YYYY-MM`. */
export type Month = string;

export interface CalendarDay {
	day: string;
	future: boolean;
}

/** A month grid cell: a day, or null for padding before the 1st / after the last. */
export interface GridCell {
	day: string | null;
	future: boolean;
}

/** Days before today the month pages reach back (the activity route's 366-day cap). */
export const MONTH_LOOKBACK_DAYS = 365;

// A known Monday, to count weekdays without the device's calendar.
const A_MONDAY = '2000-01-03';

export function monthOf(day: string): Month {
	return day.slice(0, 7);
}

function parts(month: Month): [number, number] {
	return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}

function format(year: number, month: number): Month {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function prevMonth(month: Month): Month {
	const [y, m] = parts(month);
	return m === 1 ? format(y - 1, 12) : format(y, m - 1);
}

export function nextMonth(month: Month): Month {
	const [y, m] = parts(month);
	return m === 12 ? format(y + 1, 1) : format(y, m + 1);
}

export function monthDays(month: Month): number {
	return daysBetweenDates(`${month}-01`, `${nextMonth(month)}-01`);
}

/** weekdayIndex: Monday 0 .. Sunday 6. */
export function weekdayIndex(day: string): number {
	return ((daysBetweenDates(A_MONDAY, day) % 7) + 7) % 7;
}

/** earliestMonth: the month of today - 365, the furthest the month calendar pages back. */
export function earliestMonth(today: string): Month {
	return monthOf(addDays(today, -MONTH_LOOKBACK_DAYS));
}

/** monthWindow: the days to request for a month, never past today. */
export function monthWindow(month: Month, today: string): { from: string; to: string } {
	const from = `${month}-01`;
	const end = addDays(`${nextMonth(month)}-01`, -1);
	return { from, to: end < today ? end : today };
}

/** monthGrid: the month's weeks, Monday first, padded with null cells; days after today are `future`. */
export function monthGrid(month: Month, today: string): GridCell[][] {
	const first = `${month}-01`;
	const cells: GridCell[] = [];
	for (let i = 0; i < weekdayIndex(first); i++) cells.push({ day: null, future: false });
	const count = monthDays(month);
	for (let i = 0; i < count; i++) {
		const day = addDays(first, i);
		cells.push({ day, future: day > today });
	}
	while (cells.length % 7 !== 0) cells.push({ day: null, future: false });
	const weeks: GridCell[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}

/** weekDays: Monday..Sunday of today's week; days after today are `future`. */
export function weekDays(today: string): CalendarDay[] {
	const monday = addDays(today, -weekdayIndex(today));
	return Array.from({ length: 7 }, (_, i) => {
		const day = addDays(monday, i);
		return { day, future: day > today };
	});
}
