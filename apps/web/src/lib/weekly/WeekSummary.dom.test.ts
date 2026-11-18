import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivitySource } from '$lib/api/stats';
import type { WeekView } from './loadWeek';
import type { WeekSummary as Summary } from './summary';
import WeekSummary from './WeekSummary.svelte';
import weekSummarySource from './WeekSummary.svelte?raw';
import weeklyWidgetSource from '../widgets/WeeklySummaryWidget.svelte?raw';

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
			{ key: 'journal', value: 2, previous: 1, unit: 'count' }
		],
		days: Array.from({ length: 7 }, (_, i) => ({
			date: `2026-11-${16 + i}`,
			state: i < 3 ? ('active' as const) : ('upcoming' as const),
			reviews: i < 3 ? 4 : null,
			points: i < 3 ? 4 : null
		})),
		previousDays: Array.from({ length: 7 }, (_, i) => ({
			date: `2026-11-${9 + i}`,
			state: 'inactive' as const,
			reviews: 0,
			points: 0
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
const journal: ActivitySource = {
	type: 'journal',
	plugin: 'qinqin-journal',
	label: 'Journal entries',
	unit: 'count',
	describe: { one: '{n} journal entry', other: '{n} journal entries' }
};
const view = (
	over: Partial<Summary> = {},
	activityError: string | null = null,
	sources: ActivitySource[] = [journal]
): WeekView => ({ summary: summary(over), sources, activityError });

const labels = (container: HTMLElement, selector = '.stats .stat .label'): string[] =>
	[...container.querySelectorAll(selector)].map((el) => el.textContent?.trim() ?? '');

afterEach(() => cleanup());

describe('WeekSummary — page layout', () => {
	it('four Stats in the order reviews, new cards, study time, journal, each with its change text and direction', () => {
		const { container } = render(WeekSummary, { view: view(), characters: null, locale: 'en-GB' });
		expect(labels(container)).toEqual(['Reviews', 'New cards', 'Flashcard study time', 'Journal entries']);
		const changes = [...container.querySelectorAll('.stats .stat .change')].map((el) => ({
			text: el.textContent?.trim() ?? '',
			direction: [...el.classList].find((name) => ['up', 'down', 'same'].includes(name))
		}));
		expect(changes).toEqual([
			{ text: '5 more than last week', direction: 'up' },
			{ text: 'Same as last week', direction: 'same' },
			{ text: '9 min more than last week', direction: 'up' },
			{ text: '1 more than last week', direction: 'up' }
		]);
		// The arrows are shapes; the words carry the meaning.
		for (const arrow of container.querySelectorAll('.stats .change svg')) {
			expect(arrow.closest('[aria-hidden="true"]')).not.toBeNull();
		}
	});

	it('a missing journal row is replaced by reading', () => {
		const { container } = render(WeekSummary, { view: view({}, null, []), characters: null });
		expect(labels(container)).toEqual(['Reviews', 'New cards', 'Flashcard study time', 'Reading']);
	});

	it('every other row is in the "More this week" list', () => {
		const { container } = render(WeekSummary, {
			view: view(),
			characters: { value: 3, previous: 1 },
			locale: 'en-GB'
		});
		expect(container.querySelector('.more-title')?.textContent).toBe('More this week');
		const terms = [...container.querySelectorAll('.more dt')].map((el) => el.textContent?.trim());
		expect(terms).toEqual(['Reading', 'Days active', 'Streak', 'Words reaching mature', 'Characters learned']);
		// The four numbers are not repeated in the list.
		expect(terms).not.toContain('Reviews');
		expect(terms).not.toContain('Journal entries');
	});

	it('the milestone line names this week’s milestones', () => {
		const milestones = {
			items: [
				{ id: 'streak:7', day: '2026-11-23', isNew: true },
				{ id: 'reviews:100', day: '2026-11-18', isNew: true },
				{ id: 'streak:3', day: '2026-11-16', isNew: false },
				{ id: 'days-active:10', day: '2026-11-15', isNew: false }
			],
			titles: new Map([
				['streak:7', '7-day streak'],
				['reviews:100', '100 reviews'],
				['streak:3', '3-day streak'],
				['days-active:10', '10 days active']
			])
		};
		const { container } = render(WeekSummary, { view: view(), characters: null, milestones });
		expect(container.querySelector('.milestone-line')?.textContent).toBe(
			'Milestone this week: 100 reviews, 3-day streak'
		);
	});

	it('says None when the shown week has no milestone, nothing without milestones', () => {
		const { container } = render(WeekSummary, {
			view: view(),
			characters: null,
			milestones: { items: [], titles: new Map() }
		});
		expect(container.querySelector('.milestone-line')?.textContent).toBe('Milestone this week: None');
		cleanup();
		const without = render(WeekSummary, { view: view(), characters: null });
		expect(without.container.querySelector('.milestone-line')).toBeNull();
	});

	it('offline: the numbers say so and Retry calls onretry', async () => {
		const onretry = vi.fn();
		const offline = summary({
			rows: summary().rows.map((r) =>
				r.key === 'reviews' || r.key === 'reading' || r.key === 'journal' ? { ...r, value: null, previous: null } : r
			)
		});
		render(WeekSummary, { view: { summary: offline, sources: [journal], activityError: 'Offline' }, characters: null, onretry });
		expect(screen.getAllByText('Not available offline')).toHaveLength(3);
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(onretry).toHaveBeenCalledTimes(1);
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

	it('keeps an unavailable characters row with Retry', async () => {
		const onretry = vi.fn();
		render(WeekSummary, { view: view({ mature: null }), characters: 'unavailable', onretry });
		expect(screen.getByText('Characters learned')).toBeTruthy();
		expect(screen.getByText('Not available offline')).toBeTruthy();
		expect(screen.getByText('Characters learned is not available offline.')).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(onretry).toHaveBeenCalledTimes(1);
	});
});

describe('WeekSummary — compact layout (home)', () => {
	it('keeps the rows, the trend arrows and the strip', () => {
		const { container } = render(WeekSummary, { view: view(), characters: null, layout: 'compact' });
		expect(labels(container, 'dl dt')).toEqual(['Reviews', 'New cards', 'Study time', 'Days active', 'Streak']);
		expect(container.querySelectorAll('ol > li')).toHaveLength(7);
		expect(container.querySelector('.stats')).toBeNull();
		expect(container.querySelector('.week-bars')).toBeNull();
		expect(container.querySelector('.milestone-line')).toBeNull();
	});

	it('has no bordered pill and no weight above 600 (source check)', () => {
		for (const source of [weekSummarySource, weeklyWidgetSource]) {
			const css = source.slice(source.indexOf('<style>'));
			expect(css).not.toMatch(/border-radius:\s*999px/);
			expect(css).not.toMatch(/font-weight:\s*(bold|[7-9]00|6[1-9]\d)/);
		}
	});
});
