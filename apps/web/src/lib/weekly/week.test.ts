import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/weekly/week-of.json';
import { addDays, daysBetweenDates, studyDay, type ZoneChange } from '../time/studyDay';
import {
	MAX_WEEKS_BACK,
	isSkippedDate,
	isoWeekday,
	nextWeek,
	normalizeWeekParam,
	oldestWeek,
	previousWeek,
	weekDates,
	weekOf,
	weekWindow
} from './week';

interface WeekCase {
	name: string;
	history: ZoneChange[];
	day: string;
	monday: string;
	dates: string[];
	start: string;
	end: string;
	skipped: string[];
}
interface NormalizeCase {
	name: string;
	op: 'normalize';
	today: string;
	param: string | null;
	expect: string;
}

const cases = fixture.cases as unknown as (WeekCase | NormalizeCase)[];
const weekCases = cases.filter((c): c is WeekCase => !('op' in c));
const normalizeCases = cases.filter((c): c is NormalizeCase => 'op' in c);

describe('week-of.json', () => {
	it.each(weekCases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
		const day = studyDay(c.history);
		expect(weekOf(c.day)).toBe(c.monday);
		expect(weekDates(c.monday)).toEqual(c.dates);
		const w = weekWindow(c.monday, day);
		expect(w).toEqual({ monday: c.monday, start: Date.parse(c.start), end: Date.parse(c.end) });
		expect(c.dates.filter((d) => isSkippedDate(d, day))).toEqual(c.skipped);
	});

	it.each(normalizeCases.map((c) => [c.name, c] as const))('normalize: %s', (_n, c) => {
		expect(normalizeWeekParam(c.param, c.today)).toBe(c.expect);
	});
});

describe('week math', () => {
	it('numbers the weekdays from Monday', () => {
		expect(isoWeekday('2026-11-16')).toBe(1);
		expect(isoWeekday('2026-11-22')).toBe(7);
		expect(isoWeekday('2027-01-01')).toBe(5);
	});

	it('maps every day of one week to its Monday', () => {
		for (const d of weekDates('2026-11-16')) expect(weekOf(d)).toBe('2026-11-16');
		expect(weekOf('2026-11-23')).toBe('2026-11-23');
	});

	it('lists dates across a month and a year end', () => {
		expect(weekDates('2026-11-30')).toEqual([
			'2026-11-30',
			'2026-12-01',
			'2026-12-02',
			'2026-12-03',
			'2026-12-04',
			'2026-12-05',
			'2026-12-06'
		]);
		expect(weekDates('2026-12-28').at(-1)).toBe('2027-01-03');
	});

	it('steps between weeks and stops at the current week', () => {
		expect(previousWeek('2026-11-16')).toBe('2026-11-09');
		expect(nextWeek('2026-11-09', '2026-11-18')).toBe('2026-11-16');
		expect(nextWeek('2026-11-16', '2026-11-18')).toBeNull();
		expect(nextWeek('2026-11-23', '2026-11-18')).toBeNull();
	});

	it('caps the oldest week at 52 weeks before the current one', () => {
		expect(MAX_WEEKS_BACK).toBe(52);
		expect(oldestWeek('2026-11-18')).toBe(addDays('2026-11-16', -52 * 7));
	});

	it('keeps weekOf a Monday at most six days back (2000 seeded dates)', () => {
		let seed = 81;
		const rand = (): number => {
			seed = (seed * 1103515245 + 12345) % 2147483648;
			return seed / 2147483648;
		};
		const span = daysBetweenDates('1970-01-01', '2037-12-31');
		for (let i = 0; i < 2000; i++) {
			const d = addDays('1970-01-01', Math.floor(rand() * span));
			const m = weekOf(d);
			expect(isoWeekday(m)).toBe(1);
			const gap = daysBetweenDates(m, d);
			expect(gap).toBeGreaterThanOrEqual(0);
			expect(gap).toBeLessThanOrEqual(6);
		}
	});
});
