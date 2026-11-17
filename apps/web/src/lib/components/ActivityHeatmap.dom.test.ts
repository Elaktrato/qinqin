import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	onStudyDayChange: vi.fn()
}));
vi.mock('$lib/study/studyData', () => ({ getStudyData: vi.fn() }));
vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn() }));
vi.mock('$lib/activity/viewPrefs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/activity/viewPrefs')>()),
	loadActivityView: vi.fn(() => Promise.resolve({ scope: 'workspace', hidden: [] })),
	saveActivityView: vi.fn(() => Promise.resolve())
}));

import { fetchActivity } from '$lib/api/stats';
import { loadActivityView } from '$lib/activity/viewPrefs';
import { loadStudyHistory } from '$lib/study/history';
import { getStudyData } from '$lib/study/studyData';
import { addDays, studyDay } from '$lib/time/studyDay';
import { currentStudyDay, onStudyDayChange } from '$lib/time/zone';
import { workspaces } from '$lib/workspaces';
import ActivityHeatmap from './ActivityHeatmap.svelte';

const TOKYO = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
const BERLIN = studyDay([{ zone: 'Europe/Berlin', from: null }]);
const empty = { from: '', to: '', timeZone: 'UTC', sources: [], cells: [] };

beforeEach(() => {
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(onStudyDayChange).mockReturnValue(() => {});
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('ActivityHeatmap accessibility', () => {
	it('exposes each active day to assistive tech as a list item', async () => {
		const today = studyDay([]).today();
		workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'zh' } as never });
		vi.mocked(fetchActivity).mockResolvedValue({
			from: today,
			to: today,
			timeZone: 'UTC',
			sources: [
				{
					type: 'review',
					plugin: 'flashcards',
					label: 'Reviews',
					unit: 'count',
					describe: { one: 'flashcard review', other: 'flashcard reviews' }
				}
			],
			cells: [{ day: today, workspace: 3, type: 'review', points: 5, raw: 5 }]
		});
		render(ActivityHeatmap);
		const list = await screen.findByRole('list', { name: 'Daily activity' });
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
		expect(within(list).getByRole('listitem').textContent).toContain(`${today}: 5 points`);
		// The coloured cells are decorative for assistive tech now.
		expect(document.querySelector('.grid')?.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('ActivityHeatmap learner days', () => {
	it("requests the 91 learner days ending today in the user's zone", async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-15T15:30:00Z')); // the 16th in Tokyo
		vi.mocked(currentStudyDay).mockReturnValue(TOKYO);
		vi.mocked(fetchActivity).mockResolvedValue(empty);
		workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'zh' } as never });
		render(ActivityHeatmap);
		await waitFor(() => expect(fetchActivity).toHaveBeenCalled());
		expect(vi.mocked(fetchActivity).mock.calls[0]).toEqual(['2026-08-18', '2026-11-16']);
	});

	it('re-requests the window when the zone changes', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-15T15:30:00Z'));
		let listener: ((d: typeof TOKYO) => void) | undefined;
		vi.mocked(onStudyDayChange).mockImplementation((l) => {
			listener = l;
			return () => {};
		});
		vi.mocked(currentStudyDay).mockReturnValue(BERLIN);
		vi.mocked(fetchActivity).mockResolvedValue(empty);
		workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'zh' } as never });
		render(ActivityHeatmap);
		await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(1));
		expect(vi.mocked(fetchActivity).mock.calls[0][1]).toBe('2026-11-15');
		listener!(TOKYO);
		await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(2));
		expect(vi.mocked(fetchActivity).mock.calls[1]).toEqual(['2026-08-18', '2026-11-16']);
	});
});

describe('ActivityHeatmap vacation marks', () => {
	it('hatches vacation days, says so in the tooltip and lists them for assistive tech', async () => {
		const today = studyDay([]).today();
		workspaces.set({ list: [{ id: 3, language: 'zh', name: 'zh' } as never], current: { id: 3, language: 'zh', name: 'zh' } as never });
		vi.mocked(getStudyData).mockResolvedValue({
			decks: [],
			cards: [],
			vacations: [{ version: 1, id: 'A', start: today, end: today, scope: 'all', createdDay: today, createdAt: `${today}T00:00:00Z` }]
		});
		vi.mocked(fetchActivity).mockResolvedValue({ from: today, to: today, timeZone: 'UTC', sources: [], cells: [] });
		render(ActivityHeatmap);
		await waitFor(() => expect(document.querySelectorAll('.cell.vacation')).toHaveLength(1));
		// Today is named in its text, not only ringed (#100).
		expect(document.querySelector('.cell.vacation')?.getAttribute('title')).toBe(`${today}: no activity · On vacation · today`);
		const list = screen.getByRole('list', { name: 'Daily activity' });
		expect(within(list).getAllByRole('listitem')).toHaveLength(1);
	});
});

const REVIEWS = {
	type: 'review',
	plugin: 'flashcards',
	label: 'Reviews',
	unit: 'count' as const,
	describe: { one: 'flashcard review', other: 'flashcard reviews' }
};
const WS = { id: 3, language: 'zh', name: 'zh' } as never;

/** A goal of 50 reviews a day from 60 days ago and 21 reviews today (stage: bud). */
function withGoal(): string {
	const today = studyDay([]).today();
	workspaces.set({ list: [WS], current: WS });
	vi.mocked(loadStudyHistory).mockResolvedValue({
		decks: [],
		cards: [],
		reviews: [],
		merged: 0,
		goals: {
			version: 1,
			showStreak: true,
			history: [{ from: addDays(today, -60), metric: 'activity:review', target: 50 }]
		}
	});
	vi.mocked(fetchActivity).mockResolvedValue({
		from: addDays(today, -90),
		to: today,
		timeZone: 'UTC',
		sources: [REVIEWS],
		cells: [
			{ day: today, workspace: 3, type: 'review', points: 21, raw: 21 },
			{ day: addDays(today, -1), workspace: 3, type: 'review', points: 60, raw: 60 },
			{ day: addDays(today, -2), workspace: 4, type: 'review', points: 5, raw: 5 }
		]
	});
	return today;
}

describe('ActivityHeatmap garden and flower stages', () => {
	it('renders 91 decorative tiles and one list item per day with activity or a stage', async () => {
		const today = studyDay([]).today();
		workspaces.set({ list: [WS], current: WS });
		vi.mocked(fetchActivity).mockResolvedValue({
			from: today,
			to: today,
			timeZone: 'UTC',
			sources: [REVIEWS],
			cells: [
				{ day: today, workspace: 3, type: 'review', points: 2, raw: 2 },
				{ day: addDays(today, -3), workspace: 3, type: 'review', points: 9, raw: 9 }
			]
		});
		render(ActivityHeatmap);
		const list = await screen.findByRole('list', { name: 'Daily activity' });
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
		expect(document.querySelectorAll('.grid .cell')).toHaveLength(91);
		expect(document.querySelector('.grid .level-4')).not.toBeNull();
	});

	it("with a goal in the workspace scope, a day's list text and tooltip name its stage and progress", async () => {
		const today = withGoal();
		render(ActivityHeatmap);
		const list = await screen.findByRole('list', { name: 'Daily activity' });
		// 61 goal days (60 back and today), each with a stage.
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(61));
		const items = within(list).getAllByRole('listitem').map((li) => li.textContent ?? '');
		expect(items.find((text) => text.startsWith(`${today}:`))).toContain('21 of 50 — Bud');
		expect(items.find((text) => text.startsWith(`${addDays(today, -1)}:`))).toContain('60 of 50 — In bloom');
		expect(items.find((text) => text.startsWith(`${addDays(today, -2)}:`))).toContain('0 of 50 — Nothing yet');
		const tile = document.querySelector(`.grid .cell[data-day="${today}"]`);
		expect(tile?.getAttribute('title')).toContain('21 of 50 — Bud');
	});

	it('in the all-workspaces scope no stage text appears', async () => {
		vi.mocked(loadActivityView).mockResolvedValueOnce({ scope: 'all', hidden: [] });
		withGoal();
		render(ActivityHeatmap);
		const list = await screen.findByRole('list', { name: 'Daily activity' });
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(3));
		expect(list.textContent).not.toMatch(/ of 50 — /);
	});

	it("today's tile carries the today marker and its text says today", async () => {
		const today = withGoal();
		render(ActivityHeatmap);
		await waitFor(() => expect(document.querySelector('.grid .cell.today')).not.toBeNull());
		const tile = document.querySelector('.grid .cell.today');
		expect(tile?.getAttribute('data-day')).toBe(today);
		expect(tile?.getAttribute('title')).toMatch(/ · today$/);
		expect(document.querySelectorAll('.grid .cell.today')).toHaveLength(1);
	});

	it('a failed goal load leaves the heatmap working without stages', async () => {
		const today = withGoal();
		vi.mocked(loadStudyHistory).mockRejectedValue(new Error('offline'));
		render(ActivityHeatmap);
		const list = await screen.findByRole('list', { name: 'Daily activity' });
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));
		expect(within(list).getAllByRole('listitem')[1].textContent).toContain(`${today}: 21 points`);
		expect(list.textContent).not.toMatch(/ — Bud/);
	});
});
