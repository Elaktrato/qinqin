// Locale formatting for text shown to people (issue #73, spec "Locale formatting"). Every helper formats in the
// active format locale (the interface language plus the device region, `getFormatLocale()`). Contract data —
// learner days, RFC 3339 instants, row keys, file names, API payloads — never goes through these (spec Ruling).
// Outside lib/i18n, `Intl.*Format(` and `toLocale*String(` fail the lint: use these helpers.
import { getFormatLocale, getLanguage, t } from './index';
import { isDay } from '../time/studyDay';

type Instant = Date | number | string;

const cache = new Map<string, unknown>();
function cached<T>(kind: string, locale: string, opts: object, make: () => T): T {
	const key = `${kind}|${locale}|${JSON.stringify(opts)}`;
	let v = cache.get(key) as T | undefined;
	if (v === undefined) cache.set(key, (v = make()));
	return v;
}

const numberFormat = (opts: Intl.NumberFormatOptions) =>
	cached('n', getFormatLocale(), opts, () => new Intl.NumberFormat(getFormatLocale(), opts));
const dateFormat = (opts: Intl.DateTimeFormatOptions) =>
	cached('d', getFormatLocale(), opts, () => new Intl.DateTimeFormat(getFormatLocale(), opts));

/** A number in the format locale (`1,234.5`). */
export function formatNumber(n: number, opts: Intl.NumberFormatOptions = {}): string {
	return numberFormat(opts).format(n);
}

/** A fraction as a percentage (`0.256` → `26%`; pass `maximumFractionDigits` for more). */
export function formatPercent(fraction: number, opts: Intl.NumberFormatOptions = {}): string {
	return numberFormat({ style: 'percent', ...opts }).format(fraction);
}

function toDate(instant: Instant): Date | null {
	const d = instant instanceof Date ? instant : new Date(instant);
	return Number.isNaN(d.getTime()) ? null : d;
}

function formatInstant(instant: Instant, base: Intl.DateTimeFormatOptions, opts: Intl.DateTimeFormatOptions): string {
	const d = toDate(instant);
	return d === null ? '' : dateFormat({ ...base, ...opts }).format(d);
}

/** The date of an instant in the device's zone (`Nov 16, 2026`); '' for an invalid instant. */
export function formatDate(instant: Instant, opts: Intl.DateTimeFormatOptions = {}): string {
	return formatInstant(instant, { dateStyle: 'medium' }, opts);
}

/** Date and time of an instant (`Nov 16, 2026, 2:05 PM`). */
export function formatDateTime(instant: Instant, opts: Intl.DateTimeFormatOptions = {}): string {
	return formatInstant(instant, { dateStyle: 'medium', timeStyle: 'short' }, opts);
}

/** The time of an instant (`2:05 PM`). */
export function formatTime(instant: Instant, opts: Intl.DateTimeFormatOptions = {}): string {
	return formatInstant(instant, { timeStyle: 'short' }, opts);
}

/** A learner day `YYYY-MM-DD` as UTC midnight (the study-day rule validates it), or null. */
function dayDate(day: string): Date | null {
	return isDay(day) ? new Date(`${day}T00:00:00Z`) : null;
}

/** A learner day (`YYYY-MM-DD`) shown as a date, formatted in UTC so it never shifts; invalid days unchanged. */
export function formatDay(day: string, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
	const d = dayDate(day);
	return d === null ? day : dateFormat({ ...opts, timeZone: 'UTC' }).format(d);
}

/** The weekday of a learner day (`Monday`, or `Mon` with `short`), never shifted by the zone. */
export function formatWeekday(day: string, style: 'long' | 'short' | 'narrow' = 'long'): string {
	return formatDay(day, { weekday: style });
}

/** `5 minutes ago`, `in 2 days`. */
export function formatRelative(value: number, unit: Intl.RelativeTimeFormatUnit, numeric: 'always' | 'auto' = 'always'): string {
	const locale = getFormatLocale();
	return cached('r', locale, { numeric }, () => new Intl.RelativeTimeFormat(locale, { numeric })).format(value, unit);
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 365 * 86_400_000],
	['month', 30 * 86_400_000],
	['day', 86_400_000],
	['hour', 3_600_000],
	['minute', 60_000],
	['second', 1000]
];

/** An instant relative to `now` in the largest whole unit (`3 hours ago`, `in 2 days`). */
export function formatRelativeFrom(then: Instant, now: Instant = Date.now()): string {
	const a = toDate(then);
	const b = toDate(now);
	if (a === null || b === null) return '';
	const diff = a.getTime() - b.getTime();
	for (const [unit, ms] of UNITS) {
		const n = Math.trunc(diff / ms);
		if (n !== 0) return formatRelative(n, unit);
	}
	return formatRelative(-0, 'second');
}

/** `a, b, and c` (`conjunction`), `a or b` (`disjunction`). */
export function formatList(items: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
	const locale = getFormatLocale();
	return cached('l', locale, { type }, () => new Intl.ListFormat(locale, { type })).format(items);
}

/**
 * A duration in whole seconds with catalogue plurals, at most two units (`2 hours 5 minutes`, `3 days`,
 * `59 seconds`); seconds only below a minute.
 */
export function formatDuration(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	if (s < 60) return t('format.duration.seconds', { count: s });
	const parts: string[] = [];
	const days = Math.floor(s / 86_400);
	const hours = Math.floor((s % 86_400) / 3600);
	const minutes = Math.floor((s % 3600) / 60);
	if (days > 0) parts.push(t('format.duration.days', { count: days }));
	if (hours > 0) parts.push(t('format.duration.hours', { count: hours }));
	if (minutes > 0) parts.push(t('format.duration.minutes', { count: minutes }));
	const locale = getFormatLocale();
	const list = cached('u', locale, {}, () => new Intl.ListFormat(locale, { type: 'unit', style: 'narrow' }));
	return list.format(parts.slice(0, 2));
}

/** A language code named in the interface language (`ja` → `Japanese`); the code itself when unknown or broken. */
export function languageName(code: string, locale: string = getLanguage()): string {
	if (!code) return code;
	let names: Intl.DisplayNames | null;
	try {
		names = cached('ln', locale, {}, () => new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }));
	} catch {
		return code;
	}
	try {
		const label = names.of(code.replace(/_/g, '-'));
		return !label || label.toLowerCase() === code.toLowerCase() ? code : label;
	} catch {
		return code;
	}
}
