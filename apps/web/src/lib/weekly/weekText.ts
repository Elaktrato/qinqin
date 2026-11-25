// The words of the weekly summary: headings, row labels and values, the
// comparison, the strip's names and the lines under the rows. Pure.
// Dates are civil dates formatted at UTC midnight with timeZone 'UTC', so
// no device zone ever shifts a label.

import type { ActivitySource } from '../api/stats';
import { t, type MessageKey } from '../i18n';
import { formatDay, formatDayRange, formatWeekday } from '../i18n/format';
import { formatDuration } from '../stats/readingTime';
import { activityLabel } from '../activity/sources';
import { addDays } from '../time/studyDay';
import type { CountRow, WeekDay, WeekSummary } from './summary';
import { previousWeek, weekOf } from './week';

function offline(): string {
	return t('weekly.offline');
}

/** weekRange: "16–22 November 2026" in the locale's own range form. */
export function weekRange(monday: string, locale?: string): string {
	return formatDayRange(monday, addDays(monday, 6), { day: 'numeric', month: 'long', year: 'numeric' }, locale);
}

/** weekRangeShort: "16–22 Nov", for legends and labels that already sit under a dated heading. */
export function weekRangeShort(monday: string, locale?: string): string {
	return formatDayRange(monday, addDays(monday, 6), { day: 'numeric', month: 'short' }, locale);
}

/** weekHeading: "This week (16–22 November 2026)", "Last week (…)", "Week of …". */
export function weekHeading(monday: string, today: string, locale?: string): string {
	const range = weekRange(monday, locale);
	const current = weekOf(today);
	if (monday === current) return t('weekly.heading.this', { range });
	if (monday === previousWeek(current)) return t('weekly.heading.last', { range });
	return t('weekly.heading.of', { range });
}

/**
 * compareText: "12 more than last week"; seconds compare in the whole minutes
 * shown. `inProgress` is false for a browsed past week, whose comparison is
 * the week before the shown one — never "last week" relative to today.
 */
export function compareText(
	value: number,
	previous: number,
	unit: 'count' | 'seconds',
	inProgress = true
): string {
	const same = inProgress ? 'weekly.compare.same' : 'weekly.compare.sameBefore';
	if (unit === 'seconds') {
		const diff = Math.floor(value / 60) - Math.floor(previous / 60);
		if (diff === 0) return t(same);
		const time = formatDuration(Math.abs(diff) * 60);
		const key =
			diff > 0
				? inProgress
					? 'weekly.compare.moreTime'
					: 'weekly.compare.moreTimeBefore'
				: inProgress
					? 'weekly.compare.lessTime'
					: 'weekly.compare.lessTimeBefore';
		return t(key, { time });
	}
	const diff = value - previous;
	if (diff === 0) return t(same);
	const count = Math.abs(diff);
	const key =
		diff > 0
			? inProgress
				? 'weekly.compare.more'
				: 'weekly.compare.moreBefore'
			: inProgress
				? 'weekly.compare.fewer'
				: 'weekly.compare.fewerBefore';
	return t(key, { count });
}

function weekdayLong(day: string, locale?: string): string {
	return formatWeekday(day, 'long', locale);
}

/** compareWindowText: what the comparison covers, once above the rows. */
export function compareWindowText(
	s: Pick<WeekSummary, 'inProgress' | 'today' | 'nothingToCompare'>,
	locale?: string
): string {
	if (s.nothingToCompare) return t(s.inProgress ? 'weekly.window.nothing' : 'weekly.window.nothingBefore');
	if (!s.inProgress) return t('weekly.window.weekBefore');
	const monday = weekOf(s.today);
	if (s.today === addDays(monday, 6)) return t('weekly.window.lastWeek');
	if (s.today === monday) return t('weekly.window.oneDay', { day: weekdayLong(monday, locale) });
	return t('weekly.window.days', { from: weekdayLong(monday, locale), to: weekdayLong(s.today, locale) });
}

const LABELS: Record<string, MessageKey> = {
	reviews: 'weekly.row.reviews',
	newCards: 'weekly.row.newCards',
	studyTime: 'weekly.row.studyTime',
	reading: 'weekly.row.reading',
	journal: 'weekly.row.journal'
};

export function rowLabel(row: CountRow, sources: readonly ActivitySource[]): string {
	const fixed = Object.hasOwn(LABELS, row.key) ? LABELS[row.key] : undefined;
	if (fixed !== undefined) return t(fixed);
	const type = row.key.slice('activity:'.length);
	const source = sources.find((s) => s.type === type);
	return source === undefined ? type : activityLabel(source);
}

export function rowValue(row: Pick<CountRow, 'value' | 'unit'>): string {
	if (row.value === null) return offline();
	return row.unit === 'seconds' ? formatDuration(row.value) : String(row.value);
}

/** dayShort: the visible weekday of a strip item ("Mon"). */
export function dayShort(date: string, locale?: string): string {
	return formatWeekday(date, 'short', locale);
}

/** dayName: the strip item's accessible name, "Monday 16 November: active, 42 reviews". */
export function dayName(day: WeekDay, locale?: string): string {
	const label = formatDay(day.date, { weekday: 'long', day: 'numeric', month: 'long' }, locale);
	const reviews = day.reviews !== null && day.reviews > 0 ? t('weekly.day.reviews', { count: day.reviews }) : null;
	const state: Record<WeekDay['state'], () => string> = {
		active: () => (reviews === null ? t('weekly.day.active') : t('weekly.day.activeReviews', { reviews })),
		inactive: () => t('weekly.day.inactive'),
		vacation: () => (reviews === null ? t('weekly.day.vacation') : t('weekly.day.vacationReviews', { reviews })),
		upcoming: () => t('weekly.day.upcoming'),
		skipped: () => t('weekly.day.skipped')
	};
	return t('weekly.day.name', { date: label, state: state[day.state]() });
}

export function daysActiveText(d: WeekSummary['daysActive'], inProgress: boolean): string {
	if (d.of === 0) return t('weekly.daysActive.none');
	const args = { count: d.of, active: d.active };
	const base = inProgress ? t('weekly.daysActive.soFar', args) : t('weekly.daysActive.text', args);
	return d.localOnly ? t('weekly.daysActive.localOnly', { text: base }) : base;
}

export function streakText(days: number, inProgress: boolean): string {
	return inProgress ? t('weekly.streak.text', { count: days }) : t('weekly.streak.endOfWeek', { count: days });
}

export function goalText(goal: { met: number; of: number }, inProgress: boolean): string {
	if (goal.of === 0) return t('weekly.goal.none');
	const args = { count: goal.of, met: goal.met };
	return inProgress ? t('weekly.goal.soFar', args) : t('weekly.goal.text', args);
}

/** The characters row: counted, counting, failed to load (offline), or not shown. */
export type CharactersState = { value: number; previous: number } | null | 'pending' | 'unavailable';

/** offlineText: the line above the rows naming what could not be loaded; null when nothing is missing. */
export function offlineText(activity: boolean, characters: boolean): string | null {
	if (activity && characters) return t('weekly.offlineText.both');
	if (activity) return t('weekly.offlineText.activity');
	if (characters) return t('weekly.offlineText.characters');
	return null;
}

/** One line of the summary's description list. */
export interface SummaryLine {
	id: string;
	term: string;
	value: string;
	/** The words of the comparison; null when there is none. */
	comparison: string | null;
	/** The decorative arrow's direction (the words carry the meaning). */
	trend: 'up' | 'down' | 'same' | null;
}

function trendOf(value: number, previous: number, unit: 'count' | 'seconds'): 'up' | 'down' | 'same' {
	const diff = unit === 'seconds' ? Math.floor(value / 60) - Math.floor(previous / 60) : value - previous;
	return diff > 0 ? 'up' : diff < 0 ? 'down' : 'same';
}

function countLine(
	id: string,
	term: string,
	row: Pick<CountRow, 'value' | 'previous' | 'unit'>,
	nothingToCompare: boolean,
	inProgress: boolean
): SummaryLine {
	const comparable = row.value !== null && row.previous !== null && !nothingToCompare;
	return {
		id,
		term,
		value: rowValue(row),
		comparison: comparable ? compareText(row.value!, row.previous!, row.unit, inProgress) : null,
		trend: comparable ? trendOf(row.value!, row.previous!, row.unit) : null
	};
}

/**
 * summaryLines: the rows the summary shows, in order. `compact` (the home
 * widget): reviews, new cards, study time (flashcards + reading), days
 * active and the streak. `characters`: 'pending' while counting,
 * 'unavailable' when their load failed (offline), null when not shown.
 */
export function summaryLines(
	s: WeekSummary,
	sources: readonly ActivitySource[],
	characters: CharactersState,
	compact: boolean
): SummaryLine[] {
	const byKey = new Map(s.rows.map((r) => [r.key, r]));
	const plain = (id: string, term: string, value: string): SummaryLine => ({
		id,
		term,
		value,
		comparison: null,
		trend: null
	});
	const tail = [
		plain('daysActive', t('weekly.term.daysActive'), daysActiveText(s.daysActive, s.inProgress)),
		plain('streak', t('weekly.term.streak'), streakText(s.streak, s.inProgress))
	];
	if (compact) {
		const flash = byKey.get('studyTime');
		const reading = byKey.get('reading');
		const sum = (a: number | null | undefined, b: number | null | undefined) =>
			a === null || a === undefined || b === null || b === undefined ? null : a + b;
		const time = { value: sum(flash?.value, reading?.value), previous: sum(flash?.previous, reading?.previous), unit: 'seconds' as const };
		const lines: SummaryLine[] = [];
		for (const key of ['reviews', 'newCards'] as const) {
			const row = byKey.get(key);
			if (row !== undefined) lines.push(countLine(key, rowLabel(row, sources), row, s.nothingToCompare, s.inProgress));
		}
		// Offline the reading time is unknown: the flashcard time alone, said so, without a comparison.
		const timeLine =
			time.value === null && flash !== undefined && flash.value !== null
				? plain('time', t('weekly.term.studyTime'), t('weekly.term.flashcardsOnly', { time: formatDuration(flash.value) }))
				: countLine('time', t('weekly.term.studyTime'), time, s.nothingToCompare, s.inProgress);
		return [...lines, timeLine, ...tail];
	}
	const lines = s.rows.map((row) => countLine(row.key, rowLabel(row, sources), row, s.nothingToCompare, s.inProgress));
	lines.push(...tail);
	if (s.mature !== null) {
		lines.push(countLine('mature', t('weekly.term.mature'), { ...s.mature, unit: 'count' }, s.nothingToCompare, s.inProgress));
	}
	if (characters === 'pending') lines.push(plain('characters', t('weekly.term.characters'), t('weekly.term.counting')));
	else if (characters === 'unavailable') lines.push(plain('characters', t('weekly.term.characters'), offline()));
	else if (characters !== null) {
		lines.push(countLine('characters', t('weekly.term.characters'), { ...characters, unit: 'count' }, s.nothingToCompare, s.inProgress));
	}
	if (s.goal !== null) lines.push(plain('goal', t('weekly.term.goal'), goalText(s.goal, s.inProgress)));
	return lines;
}
