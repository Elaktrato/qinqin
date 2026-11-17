import { afterEach, describe, expect, it } from 'vitest';
import {
	formatDate,
	formatDateTime,
	formatDay,
	formatDayRange,
	formatDuration,
	formatList,
	formatNumber,
	formatPercent,
	formatRelative,
	formatRelativeFrom,
	formatTime,
	formatWeekday,
	languageName
} from './format';
import { installCatalogue, resetCatalogue } from './index';
import en from './messages/en.json';

afterEach(() => resetCatalogue());

/** Intl uses narrow no-break spaces in some patterns; compare with plain spaces. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');
const inLocale = (locale: string) => installCatalogue('en', en, locale);
/** ICU versions differ in the spaces around a range dash. */
const dash = (s: string) => s.replace(/\s*–\s*/gu, '–');

const instant = Date.UTC(2026, 10, 16, 14, 5);
const utc = { timeZone: 'UTC' } as const;

describe('numbers', () => {
	it('formatNumber and formatPercent follow the format locale', () => {
		expect(formatNumber(1234.5)).toBe('1,234.5');
		inLocale('en-US');
		expect(formatNumber(1234.5)).toBe('1,234.5');
		expect(formatPercent(0.256, { maximumFractionDigits: 1 })).toBe('25.6%');
		inLocale('de');
		expect(formatNumber(1234.5)).toBe('1.234,5');
		expect(plain(formatPercent(0.256, { maximumFractionDigits: 1 }))).toBe('25,6 %');
	});
});

describe('instants', () => {
	it('formatDate, formatDateTime, formatTime in en-US, en-GB (the default) and de', () => {
		expect(formatDate(instant, utc)).toBe('16 Nov 2026');
		expect(plain(formatTime(instant, utc))).toBe('14:05');
		inLocale('en-US');
		expect(formatDate(instant, utc)).toBe('Nov 16, 2026');
		expect(plain(formatDateTime(instant, utc))).toBe('Nov 16, 2026, 2:05 PM');
		expect(plain(formatTime(instant, utc))).toBe('2:05 PM');
		inLocale('en-GB');
		expect(formatDate(instant, utc)).toBe('16 Nov 2026');
		expect(formatDateTime(new Date(instant), utc)).toBe('16 Nov 2026, 14:05');
		expect(formatTime('2026-11-16T14:05:00Z', utc)).toBe('14:05');
		inLocale('de');
		expect(formatDate(instant, utc)).toBe('16.11.2026');
	});

	it('date fields replace the default style instead of clashing with it', () => {
		const long = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } as const;
		expect(formatDate(instant, long)).toBe('16 November 2026');
		expect(plain(formatDateTime(instant, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }))).toBe('14:05');
	});

	it('an invalid instant formats as an empty string, never throws', () => {
		expect(formatDate('not a date')).toBe('');
		expect(formatDateTime(Number.NaN)).toBe('');
	});
});

describe('learner days', () => {
	it('formatDay and formatWeekday never shift with the time zone', () => {
		const saved = process.env.TZ;
		try {
			for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
				process.env.TZ = tz;
				expect(formatDay('2026-11-16')).toBe('16 Nov 2026');
				expect(formatWeekday('2026-11-16')).toBe('Monday');
				expect(formatWeekday('2026-11-16', 'short')).toBe('Mon');
			}
		} finally {
			process.env.TZ = saved;
		}
		inLocale('de');
		expect(formatDay('2026-11-16', { day: 'numeric', month: 'long' })).toBe('16. November');
	});

	it('an invalid day is returned unchanged', () => {
		expect(formatDay('2026-13-40')).toBe('2026-13-40');
	});

	it('formatDayRange: two learner days in the range form of the locale, never shifted', () => {
		const long = { day: 'numeric', month: 'long', year: 'numeric' } as const;
		const saved = process.env.TZ;
		try {
			for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
				process.env.TZ = tz;
				expect(dash(formatDayRange('2026-11-16', '2026-11-22', long, 'en-GB'))).toBe('16–22 November 2026');
			}
		} finally {
			process.env.TZ = saved;
		}
		expect(dash(formatDayRange('2026-12-28', '2027-01-03', long, 'en-GB'))).toBe('28 December 2026–3 January 2027');
		inLocale('de');
		expect(dash(formatDayRange('2026-11-16', '2026-11-22', long))).toBe('16.–22. November 2026');
		expect(formatDayRange('2026-11-16', 'nope')).toBe('2026-11-16 – nope');
	});

	it('an explicit locale overrides the format locale for one call', () => {
		expect(formatNumber(100000, {}, 'de')).toBe('100.000');
		expect(formatDay('2026-11-03', { day: 'numeric', month: 'long', year: 'numeric' }, 'en-GB')).toBe('3 November 2026');
		expect(formatWeekday('2026-11-16', 'long', 'de')).toBe('Montag');
		expect(formatNumber(100000)).toBe('100,000');
	});
});

describe('relative times', () => {
	it('formatRelative', () => {
		expect(formatRelative(-5, 'minute')).toBe('5 minutes ago');
		expect(formatRelative(2, 'day')).toBe('in 2 days');
		inLocale('de');
		expect(formatRelative(-5, 'minute')).toBe('vor 5 Minuten');
	});

	it('formatRelativeFrom picks the largest whole unit', () => {
		const now = Date.UTC(2026, 10, 16, 12);
		expect(formatRelativeFrom(now - 30_000, now)).toBe('30 seconds ago');
		expect(formatRelativeFrom(now - 5 * 60_000, now)).toBe('5 minutes ago');
		expect(formatRelativeFrom(now - 3 * 3_600_000, now)).toBe('3 hours ago');
		expect(formatRelativeFrom(now + 2 * 86_400_000, now)).toBe('in 2 days');
		expect(formatRelativeFrom(now - 400 * 86_400_000, now)).toBe('1 year ago');
		expect(formatRelativeFrom(now, now)).toBe('0 seconds ago');
	});
});

describe('formatDuration', () => {
	it('uses catalogue plurals for up to two units', () => {
		expect(formatDuration(0)).toBe('0 seconds');
		expect(formatDuration(1)).toBe('1 second');
		expect(formatDuration(59)).toBe('59 seconds');
		expect(formatDuration(60)).toBe('1 minute');
		expect(formatDuration(3600)).toBe('1 hour');
		expect(formatDuration(7500)).toBe('2 hours 5 minutes');
		expect(formatDuration(7530)).toBe('2 hours 5 minutes');
		expect(formatDuration(86_400 + 3600)).toBe('1 day 1 hour');
		expect(formatDuration(3 * 86_400 + 59)).toBe('3 days');
	});
	it('formats the count with the locale', () => {
		inLocale('en-GB');
		expect(formatDuration(1500 * 86_400)).toBe('1,500 days');
	});
});

describe('lists and language names', () => {
	it('formatList', () => {
		expect(formatList(['a', 'b', 'c'])).toBe('a, b and c');
		inLocale('en-US');
		expect(formatList(['a', 'b', 'c'])).toBe('a, b, and c');
		expect(formatList(['a', 'b'], 'disjunction')).toBe('a or b');
	});
	it('languageName in the interface language, the code for unknown or broken codes', () => {
		expect(languageName('ja')).toBe('Japanese');
		expect(languageName('zh-Hant')).toBe('Traditional Chinese');
		expect(languageName('')).toBe('');
		expect(languageName('!!')).toBe('!!');
		expect(languageName('zh-Hans', 'en', 'standard')).toBe('Chinese (Simplified)');
		expect(languageName('zh-Hant', 'en', 'standard')).toBe('Chinese (Traditional)');
		expect(languageName('de', 'en', 'standard')).toBe('German');
	});
});
