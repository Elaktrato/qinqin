import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('$lib/time/zone', () => ({ currentStudyDay: vi.fn(), onStudyDayChange: vi.fn() }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	getStudyData: vi.fn(),
	loadStudyHistory: vi.fn()
}));
vi.mock('$lib/activity/viewPrefs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/activity/viewPrefs')>()),
	loadActivityView: vi.fn(() => Promise.resolve({ scope: 'workspace', hidden: [] })),
	saveActivityView: vi.fn(() => Promise.resolve())
}));

import { HEATMAP_DAYS } from '$lib/activity/activity';
import { fetchActivity, type ActivityResponse } from '$lib/api/stats';
import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
import { loadStudyHistory, getStudyData } from '$lib/study/data';
import { addDays, studyDay } from '$lib/time/studyDay';
import { currentStudyDay, onStudyDayChange } from '$lib/time/zone';
import { workspaces } from '$lib/workspaces';

const WS = { id: 3, language: 'zh', name: 'zh' } as never;
const REVIEWS = {
	type: 'review',
	plugin: 'flashcards',
	label: 'Reviews',
	unit: 'count' as const,
	describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' }
};

function reply(from: string, to: string, cells: ActivityResponse['cells'] = []): ActivityResponse {
	return { from, to, timeZone: 'UTC', sources: [REVIEWS], cells };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-18T12:00:00Z')); // a Wednesday
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(onStudyDayChange).mockReturnValue(() => {});
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(fetchActivity).mockImplementation(async (from, to) => reply(from, to));
	workspaces.set({ list: [WS], current: WS });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

function withGoal(target = 50): void {
	vi.mocked(loadStudyHistory).mockResolvedValue({
		decks: [],
		cards: [],
		reviews: [],
		merged: 0,
		goals: { version: 1, showStreak: true, history: [{ from: '2026-09-01', metric: 'activity:review', target }] }
	});
}

const CELLS = [
	{ day: '2026-11-16', workspace: 3, type: 'review', points: 60, raw: 60 },
	{ day: '2026-11-17', workspace: 3, type: 'review', points: 3, raw: 3 },
	{ day: '2026-11-18', workspace: 3, type: 'review', points: 21, raw: 21 }
];

describe('HeatmapWeek', () => {
	it('shows seven large tiles Monday..Sunday with weekday names, from the 52-week response', async () => {
		render(ActivityHeatmap, { layout: 'week' });
		await waitFor(() => expect(document.querySelectorAll('.week-days .tile')).toHaveLength(7));
		const names = [...document.querySelectorAll('.week-days .wd')].map((e) => e.textContent);
		expect(names).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
		expect(vi.mocked(fetchActivity)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetchActivity).mock.calls[0]).toEqual([
			addDays('2026-11-18', -(HEATMAP_DAYS - 1)),
			'2026-11-18'
		]);
	});

	it('shows "21/50" under each past or today tile with a goal, else the points', async () => {
		vi.mocked(fetchActivity).mockImplementation(async (from, to) => reply(from, to, CELLS));
		const { unmount } = render(ActivityHeatmap, { layout: 'week' });
		await waitFor(() =>
			expect([...document.querySelectorAll('.week-days .amount')].map((e) => e.textContent)).toEqual([
				'60',
				'3',
				'21',
				'',
				'',
				'',
				''
			])
		);
		unmount();
		withGoal();
		render(ActivityHeatmap, { layout: 'week' });
		await waitFor(() =>
			expect([...document.querySelectorAll('.week-days .amount')].map((e) => e.textContent)).toEqual([
				'60/50',
				'3/50',
				'21/50',
				'',
				'',
				'',
				''
			])
		);
	});

	it('future days are empty outlines', async () => {
		render(ActivityHeatmap, { layout: 'week' });
		await waitFor(() => expect(document.querySelectorAll('.week-days .tile.future')).toHaveLength(4));
		expect(document.querySelector('.week-days .tile.today')?.getAttribute('data-day')).toBe('2026-11-18');
	});

	it('the block is one link to /stats/week with an accessible name', async () => {
		render(ActivityHeatmap, { layout: 'week' });
		const link = await screen.findByRole('link', { name: 'This week — open Stats, Week' });
		expect(link.getAttribute('href')).toBe('/stats/week');
		expect(screen.getAllByRole('link')).toHaveLength(1);
		expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
	});

	it('says what is left today when a goal is open, and lists only this week', async () => {
		vi.mocked(fetchActivity).mockImplementation(async (from, to) =>
			reply(from, to, [...CELLS, { day: '2026-11-01', workspace: 3, type: 'review', points: 9, raw: 9 }])
		);
		withGoal();
		render(ActivityHeatmap, { layout: 'week' });
		expect(await screen.findByText('29 flashcard reviews to go today')).toBeTruthy();
		const list = screen.getByRole('list', { name: 'Daily activity' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(3);
	});

	it('says the goal is reached, or the week points without a goal', async () => {
		vi.mocked(fetchActivity).mockImplementation(async (from, to) => reply(from, to, CELLS));
		const { unmount } = render(ActivityHeatmap, { layout: 'week' });
		expect(await screen.findByText('84 points this week')).toBeTruthy();
		unmount();
		withGoal(20);
		render(ActivityHeatmap, { layout: 'week' });
		expect(await screen.findByText('Goal reached')).toBeTruthy();
	});
});
