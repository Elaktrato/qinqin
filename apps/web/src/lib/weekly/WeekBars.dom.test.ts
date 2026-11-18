import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { WeekDay, WeekSummary } from './summary';
import WeekBars from './WeekBars.svelte';

function day(date: string, over: Partial<WeekDay> = {}): WeekDay {
	return { date, state: 'inactive', reviews: 0, points: 0, ...over };
}

const DAYS: WeekDay[] = [
	day('2026-11-16', { state: 'active', points: 42, reviews: 42 }),
	day('2026-11-17', { state: 'active', points: 10, reviews: 10 }),
	day('2026-11-18', { state: 'inactive', points: 0 }),
	day('2026-11-19', { state: 'upcoming', points: null, reviews: null }),
	day('2026-11-20', { state: 'upcoming', points: null, reviews: null }),
	day('2026-11-21', { state: 'vacation', points: 0 }),
	day('2026-11-22', { state: 'skipped', points: 0 })
];

const PREVIOUS: WeekDay[] = [
	day('2026-11-09', { state: 'active', points: 30 }),
	day('2026-11-10', { state: 'active', points: 60 }),
	day('2026-11-11', { state: 'inactive', points: 0 }),
	day('2026-11-12', { state: 'inactive', points: 0 }),
	day('2026-11-13', { state: 'vacation', points: 0 }),
	day('2026-11-14', { state: 'inactive', points: 0 }),
	day('2026-11-15', { state: 'inactive', points: 0 })
];

const summary = { days: DAYS, previousDays: PREVIOUS } as Pick<WeekSummary, 'days' | 'previousDays'>;

afterEach(() => cleanup());

describe('WeekBars', () => {
	it('seven columns, each with a this-week and a last-week bar scaled to the larger of both weeks', () => {
		const { container } = render(WeekBars, { summary, locale: 'en-GB' });

		const columns = [...container.querySelectorAll('[data-day]')];
		expect(columns).toHaveLength(7);
		const first = columns[0];
		expect(first.querySelector('.bar.now')).not.toBeNull();
		expect(first.querySelector('.bar.last')).not.toBeNull();
		// Monday this week 42, last week 30; the busiest value in both weeks is 60.
		expect(parseFloat((first.querySelector('.bar.now') as HTMLElement).style.height)).toBeCloseTo(
			(42 / 60) * 100,
			5
		);
		expect(parseFloat((first.querySelector('.bar.last') as HTMLElement).style.height)).toBeCloseTo(
			(30 / 60) * 100,
			5
		);
		// A zero day keeps its column but has no bar.
		expect(columns[2].querySelector('.bar')).toBeNull();
	});

	it('upcoming days have no this-week bar and say upcoming', () => {
		const { container } = render(WeekBars, { summary, locale: 'en-GB' });
		const upcoming = container.querySelector('[data-day="2026-11-19"]')!;
		expect(upcoming.querySelector('.bar.now')).toBeNull();
		expect(upcoming.getAttribute('title')).toContain('upcoming');
		expect(upcoming.getAttribute('title')).toContain('0 points this week');
	});

	it('each column’s hidden text and title read the day, both weeks and the state', () => {
		const { container } = render(WeekBars, { summary, locale: 'en-GB' });
		const monday = container.querySelector('[data-day="2026-11-16"]')!;
		expect(monday.getAttribute('title')).toBe('Monday: 42 points this week, 30 last week, active');
		expect(monday.getAttribute('title')).toBe('Monday: 42 points this week, 30 last week, active');
		const list = [...container.querySelectorAll('ul.sr-only li')].map((li) => li.textContent);
		expect(list).toContain('Monday: 42 points this week, 30 last week, active');
		expect(list).toContain('Thursday: 0 points this week, 0 last week, upcoming');
		expect(container.querySelector('.chart')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('the legend names both weeks', () => {
		render(WeekBars, { summary, locale: 'en-GB' });
		expect(screen.getByText('This week')).toBeTruthy();
		expect(screen.getByText('Last week')).toBeTruthy();
		expect(screen.getByText('This week and last week, per day')).toBeTruthy();
	});
});
