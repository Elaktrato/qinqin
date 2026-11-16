import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WeekView } from './loadWeek';
import type { WeekSummary as Summary } from './summary';
import WeekSummary from './WeekSummary.svelte';

function summary(over: Partial<Summary> = {}): Summary {
	return {
		monday: '2026-11-16',
		today: '2026-11-18',
		inProgress: true,
		compareThrough: '2026-11-11',
		rows: [
			{ key: 'reviews', value: 12, previous: 7, unit: 'count' },
			{ key: 'newCards', value: 1, previous: 1, unit: 'count' },
			{ key: 'studyTime', value: 600, previous: 60, unit: 'seconds' },
			{ key: 'reading', value: 0, previous: 0, unit: 'seconds' },
			{ key: 'journal', value: 0, previous: 0, unit: 'count' }
		],
		days: Array.from({ length: 7 }, (_, i) => ({
			date: `2026-11-${16 + i}`,
			state: i < 3 ? ('active' as const) : ('upcoming' as const),
			reviews: i < 3 ? 4 : null,
			points: i < 3 ? 4 : null
		})),
		daysActive: { active: 3, of: 3, localOnly: false },
		streak: 4,
		mature: { value: 2, previous: 0 },
		characters: null,
		goal: null,
		allVacation: false,
		nothingToCompare: false,
		...over
	};
}
const view = (over: Partial<Summary> = {}, activityError: string | null = null): WeekView => ({
	summary: summary(over),
	sources: [],
	activityError
});

afterEach(() => cleanup());

describe('WeekSummary', () => {
	it('is a description list in row order with the comparison in words', () => {
		const { container } = render(WeekSummary, { view: view(), characters: null, locale: 'en-GB' });
		const terms = [...container.querySelectorAll('dl dt')].map((t) => t.textContent);
		expect(terms).toEqual([
			'Reviews',
			'New cards',
			'Flashcard study time',
			'Reading',
			'Journal entries',
			'Days active',
			'Streak',
			'Words reaching mature'
		]);
		expect(screen.getByText('5 more than last week')).toBeTruthy();
		for (const arrow of container.querySelectorAll('.arrow')) expect(arrow.getAttribute('aria-hidden')).toBe('true');
		expect(screen.getByText('In progress')).toBeTruthy();
		expect(screen.getByText('Compared with Monday to Wednesday last week')).toBeTruthy();
		expect(container.querySelectorAll('ol > li')).toHaveLength(7);
	});

	it('offline: the rows say so and Retry calls onretry', async () => {
		const onretry = vi.fn();
		const offline = summary({
			rows: summary().rows.map((r) =>
				r.key === 'reviews' || r.key === 'reading' || r.key === 'journal' ? { ...r, value: null, previous: null } : r
			)
		});
		render(WeekSummary, { view: { summary: offline, sources: [], activityError: 'Offline' }, characters: null, onretry });
		expect(screen.getAllByText('Not available offline')).toHaveLength(3);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(onretry).toHaveBeenCalledTimes(1);
	});

	it('compact: reviews, new cards, study time, days active, streak and the strip', () => {
		const { container } = render(WeekSummary, { view: view(), characters: null, compact: true });
		const terms = [...container.querySelectorAll('dl dt')].map((t) => t.textContent);
		expect(terms).toEqual(['Reviews', 'New cards', 'Study time', 'Days active', 'Streak']);
		expect(container.querySelectorAll('ol > li')).toHaveLength(7);
	});

	it('labels a week on vacation and a completed week', () => {
		render(WeekSummary, { view: view({ inProgress: false, allVacation: true, monday: '2026-11-02' }), characters: null });
		expect(screen.getByText('On vacation all week')).toBeTruthy();
		expect(screen.queryByText('In progress')).toBeNull();
	});

	it('shows the characters row while counting and when counted, not without', () => {
		const pending = render(WeekSummary, { view: view(), characters: 'pending' });
		expect(screen.getByText('Counting characters…')).toBeTruthy();
		pending.unmount();
		render(WeekSummary, { view: view({ mature: null }), characters: { value: 3, previous: 1 } });
		expect(screen.getByText('Characters learned')).toBeTruthy();
		expect(screen.getByText('2 more than last week')).toBeTruthy();
	});
});
