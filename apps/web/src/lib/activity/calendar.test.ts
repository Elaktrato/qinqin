import { describe, expect, it } from 'vitest';
import {
	earliestMonth,
	monthDays,
	monthGrid,
	monthOf,
	monthWindow,
	nextMonth,
	prevMonth,
	weekDays,
	weekdayIndex
} from './calendar';

describe('months', () => {
	it('monthOf takes the YYYY-MM of a day', () => {
		expect(monthOf('2026-11-16')).toBe('2026-11');
	});

	it('pages back and forward across years', () => {
		expect(prevMonth('2026-01')).toBe('2025-12');
		expect(prevMonth('2026-11')).toBe('2026-10');
		expect(nextMonth('2025-12')).toBe('2026-01');
	});

	it('earliestMonth is the month of today - 365 (the activity route cap)', () => {
		expect(earliestMonth('2026-11-16')).toBe('2025-11');
		expect(earliestMonth('2028-03-01')).toBe('2027-03');
	});

	it('monthDays counts leap Februaries', () => {
		expect(monthDays('2028-02')).toBe(29);
		expect(monthDays('2026-02')).toBe(28);
		expect(monthDays('2026-11')).toBe(30);
	});

	it('monthWindow ends at today in the current month and at month end before', () => {
		expect(monthWindow('2026-11', '2026-11-16')).toEqual({ from: '2026-11-01', to: '2026-11-16' });
		expect(monthWindow('2026-10', '2026-11-16')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
	});
});

describe('monthGrid', () => {
	it('pads to Monday, holds every day and flags days after today', () => {
		const weeks = monthGrid('2026-11', '2026-11-16');
		// 1 Nov 2026 is a Sunday: six blanks (Mon 26 Oct .. Sat 31 Oct) before it.
		expect(weeks[0].slice(0, 6).every((c) => c.day === null)).toBe(true);
		expect(weeks[0][6]).toEqual({ day: '2026-11-01', future: false });
		const days = weeks.flat().filter((c) => c.day !== null);
		expect(days).toHaveLength(30);
		expect(weeks.every((w) => w.length === 7)).toBe(true);
		expect(days.find((c) => c.day === '2026-11-16')?.future).toBe(false);
		expect(days.filter((c) => c.future).map((c) => c.day)[0]).toBe('2026-11-17');
		expect(days.filter((c) => c.future)).toHaveLength(14);
	});

	it('has 29 days in a leap February', () => {
		expect(monthGrid('2028-02', '2028-12-01').flat().filter((c) => c.day !== null)).toHaveLength(29);
	});

	it('has no padding for a month starting on Monday', () => {
		// 1 June 2026 is a Monday.
		expect(monthGrid('2026-06', '2026-11-16')[0][0]).toEqual({ day: '2026-06-01', future: false });
	});
});

describe('weekDays', () => {
	it('weekdayIndex is Monday 0 .. Sunday 6', () => {
		expect(weekdayIndex('2026-11-16')).toBe(0);
		expect(weekdayIndex('2026-11-22')).toBe(6);
	});

	it('for a Sunday returns the Monday six days back..that Sunday, none future', () => {
		const week = weekDays('2026-11-22');
		expect(week.map((d) => d.day)).toEqual([
			'2026-11-16',
			'2026-11-17',
			'2026-11-18',
			'2026-11-19',
			'2026-11-20',
			'2026-11-21',
			'2026-11-22'
		]);
		expect(week.some((d) => d.future)).toBe(false);
	});

	it('for a Monday has six future days', () => {
		const week = weekDays('2026-11-16');
		expect(week[0]).toEqual({ day: '2026-11-16', future: false });
		expect(week.filter((d) => d.future)).toHaveLength(6);
	});
});
