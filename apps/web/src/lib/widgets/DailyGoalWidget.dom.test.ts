import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/goals/loadGoal', () => ({ loadGoalStatus: vi.fn() }));

import type { ActivitySource } from '$lib/api/stats';
import type { GoalView } from '$lib/goals/loadGoal';
import { loadGoalStatus } from '$lib/goals/loadGoal';
import type { GoalDay } from '$lib/goals/progress';
import DailyGoalWidget from './DailyGoalWidget.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const SOURCES: ActivitySource[] = [
	{
		type: 'review',
		plugin: 'qinqin-flashcards',
		label: 'Flashcard reviews',
		unit: 'count',
		describe: { one: '{n} flashcard review', other: '{n} flashcard reviews' }
	}
];

function today(partial: Partial<GoalDay> = {}): GoalDay {
	return {
		day: '2026-11-16',
		status: 'open',
		metric: 'activity:review',
		target: 50,
		amount: 32,
		fraction: 0.64,
		unavailable: false,
		...partial
	};
}

const ROW = {
	version: 1 as const,
	showStreak: true,
	history: [{ from: '2026-11-01', metric: 'activity:review' as const, target: 50 }]
};

function view(partial: Partial<GoalView> = {}): GoalView {
	return {
		row: ROW,
		newer: false,
		today: today(),
		streak: { current: 4, todayMet: false, capped: false },
		sources: SOURCES,
		limitsNew: 20,
		activityError: null,
		...partial
	};
}

const NONE = today({ status: 'none', metric: null, target: null, amount: 0, fraction: 0 });

function select(id: number | null): void {
	ctx.session.workspaces.set({
		list: [],
		current: id === null ? null : ({ id, language: 'zh', name: `w${id}` } as never)
	});
}

beforeEach(() => select(1));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('DailyGoalWidget', () => {
	it('offers to set a goal when there is none', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(view({ row: null, today: NONE, streak: null, sources: [] }));
		render(DailyGoalWidget, { context: ctx.context });
		const link = await screen.findByRole('link', { name: 'Set a daily goal' });
		expect(link.getAttribute('href')).toBe('/settings?tab=study');
		expect(screen.queryByRole('progressbar')).toBeNull();
		expect(loadGoalStatus).toHaveBeenCalledWith(expect.anything(), 1, { force: false });
	});

	it('shows the ring, the progress text and the streak line', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(view());
		render(DailyGoalWidget, { context: ctx.context });
		const bar = await screen.findByRole('progressbar');
		expect(bar.getAttribute('aria-valuetext')).toBe('32 of 50 flashcard reviews today');
		expect(screen.getByText('32 of 50 flashcard reviews today')).toBeTruthy();
		expect(screen.getByText('Goal streak: 4 days')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Edit goal' }).getAttribute('href')).toBe('/settings?tab=study');
	});

	it('has no streak line when the streak is hidden', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(view({ streak: null, row: { ...ROW, showStreak: false } }));
		render(DailyGoalWidget, { context: ctx.context });
		await screen.findByRole('progressbar');
		expect(screen.queryByText(/Goal streak/)).toBeNull();
	});

	it('shows the paused text on vacation', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(
			view({ today: today({ status: 'vacation', fraction: 0 }), streak: { current: 4, todayMet: true, capped: false } })
		);
		render(DailyGoalWidget, { context: ctx.context });
		expect(await screen.findByText('On vacation — goal paused')).toBeTruthy();
		expect(screen.queryByRole('progressbar')).toBeNull();
	});

	it('says when a newer version set the goal', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(view({ row: null, newer: true, today: NONE, streak: null }));
		render(DailyGoalWidget, { context: ctx.context });
		expect(await screen.findByText(/set by a newer version of qinqin/)).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Set a daily goal' })).toBeNull();
	});

	it('shows the activity error (offline) instead of "no longer counted"', async () => {
		vi.mocked(loadGoalStatus).mockResolvedValue(
			view({
				activityError: 'offline',
				today: today({ status: 'none', amount: 0, fraction: 0, unavailable: true }),
				streak: null
			})
		);
		render(DailyGoalWidget, { context: ctx.context });
		expect(await screen.findByText(/offline/)).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
		expect(screen.queryByText("This goal's activity is no longer counted")).toBeNull();
	});

	it('asks for a workspace without one', async () => {
		select(null);
		render(DailyGoalWidget, { context: ctx.context });
		expect(await screen.findByText('Choose a workspace in the header to set a daily goal.')).toBeTruthy();
		expect(loadGoalStatus).not.toHaveBeenCalled();
	});

	it('shows the error with Try again, which forces a reload', async () => {
		vi.mocked(loadGoalStatus).mockRejectedValueOnce(new Error('offline'));
		render(DailyGoalWidget, { context: ctx.context });
		const retry = await screen.findByRole('button', { name: 'Try again' });
		expect(screen.getByText('Could not load your daily goal.')).toBeTruthy();
		vi.mocked(loadGoalStatus).mockResolvedValue(view());
		retry.click();
		await screen.findByRole('progressbar');
		expect(loadGoalStatus).toHaveBeenLastCalledWith(expect.anything(), 1, { force: true });
	});

	it('reloads on a workspace switch and ignores the stale answer', async () => {
		let resolveFirst: (v: GoalView) => void = () => {};
		vi.mocked(loadGoalStatus)
			.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
			.mockResolvedValueOnce(view({ today: today({ amount: 7, fraction: 0.14 }) }));
		render(DailyGoalWidget, { context: ctx.context });
		select(2);
		await screen.findByText('7 of 50 flashcard reviews today');
		resolveFirst(view({ today: today({ amount: 40, fraction: 0.8 }) }));
		await new Promise((r) => setTimeout(r, 0));
		await waitFor(() => expect(screen.queryByText('40 of 50 flashcard reviews today')).toBeNull());
		expect(screen.getByText('7 of 50 flashcard reviews today')).toBeTruthy();
		expect(vi.mocked(loadGoalStatus).mock.calls.map((c) => c[1])).toEqual([1, 2]);
	});
});
