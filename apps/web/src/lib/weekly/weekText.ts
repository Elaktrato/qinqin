// The words of the weekly summary: headings, row labels and values, the
// comparison, the strip's names and the lines under the rows. Pure.
// Dates are civil dates formatted at UTC midnight with timeZone 'UTC', so
// no device zone ever shifts a label.

import type { ActivitySource } from '../api/stats';
import { formatDuration } from '../stats/readingTime';
import { addDays } from '../time/studyDay';
import type { CountRow, WeekDay, WeekSummary } from './summary';
import { previousWeek, weekOf } from './week';

const OFFLINE = 'Not available offline';

function utcDate(day: string): Date {
	return new Date(`${day}T00:00:00Z`);
}

function plural(n: number, one: string, other: string): string {
	return `${n} ${n === 1 ? one : other}`;
}

/** weekRange: "16–22 November 2026" in the locale's own range form. */
export function weekRange(monday: string, locale?: string): string {
	const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
	return fmt.formatRange(utcDate(monday), utcDate(addDays(monday, 6)));
}

/** weekHeading: "This week (16–22 November 2026)", "Last week (…)", "Week of …". */
export function weekHeading(monday: string, today: string, locale?: string): string {
	const range = weekRange(monday, locale);
	const current = weekOf(today);
	if (monday === current) return `This week (${range})`;
	if (monday === previousWeek(current)) return `Last week (${range})`;
	return `Week of ${range}`;
}

/** compareText: "12 more than last week"; seconds compare in the whole minutes shown. */
export function compareText(value: number, previous: number, unit: 'count' | 'seconds'): string {
	if (unit === 'seconds') {
		const diff = Math.floor(value / 60) - Math.floor(previous / 60);
		if (diff === 0) return 'Same as last week';
		return `${formatDuration(Math.abs(diff) * 60)} ${diff > 0 ? 'more' : 'less'} than last week`;
	}
	const diff = value - previous;
	if (diff === 0) return 'Same as last week';
	return `${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than last week`;
}

function weekdayLong(day: string, locale?: string): string {
	return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(utcDate(day));
}

/** compareWindowText: what the comparison covers, once above the rows. */
export function compareWindowText(
	s: Pick<WeekSummary, 'inProgress' | 'today' | 'nothingToCompare'>,
	locale?: string
): string {
	if (s.nothingToCompare) return 'Nothing last week to compare';
	if (!s.inProgress) return 'Compared with the week before';
	const monday = weekOf(s.today);
	if (s.today === addDays(monday, 6)) return 'Compared with last week';
	if (s.today === monday) return `Compared with ${weekdayLong(monday, locale)} last week`;
	return `Compared with ${weekdayLong(monday, locale)} to ${weekdayLong(s.today, locale)} last week`;
}

const LABELS: Record<string, string> = {
	reviews: 'Reviews',
	newCards: 'New cards',
	studyTime: 'Flashcard study time',
	reading: 'Reading',
	journal: 'Journal entries'
};

export function rowLabel(row: CountRow, sources: readonly ActivitySource[]): string {
	const fixed = LABELS[row.key];
	if (fixed !== undefined) return fixed;
	const type = row.key.slice('activity:'.length);
	return sources.find((s) => s.type === type)?.label ?? type;
}

export function rowValue(row: Pick<CountRow, 'value' | 'unit'>): string {
	if (row.value === null) return OFFLINE;
	return row.unit === 'seconds' ? formatDuration(row.value) : String(row.value);
}

/** dayShort: the visible weekday of a strip item ("Mon"). */
export function dayShort(date: string, locale?: string): string {
	return new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(utcDate(date));
}

/** dayName: the strip item's accessible name, "Monday 16 November: active, 42 reviews". */
export function dayName(day: WeekDay, locale?: string): string {
	const label = new Intl.DateTimeFormat(locale, {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		timeZone: 'UTC'
	}).format(utcDate(day.date));
	const reviews = day.reviews !== null && day.reviews > 0 ? `, ${plural(day.reviews, 'review', 'reviews')}` : '';
	const state: Record<WeekDay['state'], string> = {
		active: `active${reviews}`,
		inactive: 'not active',
		vacation: `vacation${reviews}`,
		upcoming: 'upcoming',
		skipped: 'no such day'
	};
	return `${label}: ${state[day.state]}`;
}

export function daysActiveText(d: WeekSummary['daysActive'], inProgress: boolean): string {
	if (d.of === 0) return 'No days to count';
	const base = `Active on ${d.active} of ${plural(d.of, 'day', 'days')}${inProgress ? ' so far' : ''}`;
	return d.localOnly ? `${base} (from flashcard reviews only)` : base;
}

export function streakText(days: number, inProgress: boolean): string {
	const label = inProgress ? 'Study streak' : 'Study streak at the end of the week';
	return `${label}: ${plural(days, 'day', 'days')}`;
}

export function goalText(goal: { met: number; of: number }, inProgress: boolean): string {
	if (goal.of === 0) return 'No goal days to count';
	return `Daily goal met on ${goal.met} of ${plural(goal.of, 'day', 'days')}${inProgress ? ' so far' : ''}`;
}
