import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { WeekDay } from './summary';
import { dayName, dayShort } from './weekText';
import WeekStrip from './WeekStrip.svelte';

const DAYS: WeekDay[] = [
	{ date: '2026-11-16', state: 'active', reviews: 42, points: 42 },
	{ date: '2026-11-17', state: 'inactive', reviews: 0, points: 0 },
	{ date: '2026-11-18', state: 'vacation', reviews: 3, points: 3 },
	{ date: '2026-11-19', state: 'skipped', reviews: 0, points: 0 },
	{ date: '2026-11-20', state: 'upcoming', reviews: null, points: null },
	{ date: '2026-11-21', state: 'upcoming', reviews: null, points: null },
	{ date: '2026-11-22', state: 'upcoming', reviews: null, points: null }
];

afterEach(() => cleanup());

describe('WeekStrip', () => {
	it('is a list of seven days with visible weekdays and full names', () => {
		const { container } = render(WeekStrip, { days: DAYS, locale: 'en-GB' });
		expect(container.querySelector('ol')?.getAttribute('aria-label')).toBe('Days of the week');
		const items = container.querySelectorAll('ol > li');
		expect(items).toHaveLength(7);
		items.forEach((li, i) => {
			expect(li.querySelector('.wd')?.textContent).toBe(dayShort(DAYS[i].date, 'en-GB'));
			expect(li.querySelector('.sr-only')?.textContent).toBe(dayName(DAYS[i], 'en-GB'));
			expect(li.getAttribute('title')).toBe(dayName(DAYS[i], 'en-GB'));
			expect(li.classList.contains(DAYS[i].state)).toBe(true);
		});
	});

	it('marks the states with distinct text, not colour alone', () => {
		const { container } = render(WeekStrip, { days: DAYS, locale: 'en-GB' });
		const marks = [...container.querySelectorAll('ol > li .mark')].map((m) => m.textContent);
		expect(new Set(marks.slice(0, 5)).size).toBe(5);
		for (const m of container.querySelectorAll('.mark, .wd')) expect(m.getAttribute('aria-hidden')).toBe('true');
	});
});
