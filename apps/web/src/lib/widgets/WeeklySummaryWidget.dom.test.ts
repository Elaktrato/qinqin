import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/weekly/loadWeek', () => ({ loadWeek: vi.fn(), loadWeekCharacters: vi.fn() }));
vi.mock('$lib/studycore/currentContext', () => ({ onContextStale: vi.fn(() => () => {}) }));

import { onContextStale } from '$lib/studycore/currentContext';
import { loadWeek, loadWeekCharacters, type WeekView } from '$lib/weekly/loadWeek';
import type { WeekSummary } from '$lib/weekly/summary';
import { weekOf } from '$lib/weekly/week';
import WeeklySummaryWidget from './WeeklySummaryWidget.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

function view(reviews: number | null = 12, activityError: string | null = null): WeekView {
	const summary: WeekSummary = {
		monday: '2026-11-16',
		today: '2026-11-18',
		inProgress: true,
		compareThrough: '2026-11-11',
		rows: [
			{ key: 'reviews', value: reviews, previous: reviews === null ? null : 7, unit: 'count' },
			{ key: 'newCards', value: 1, previous: 1, unit: 'count' },
			{ key: 'studyTime', value: 600, previous: 60, unit: 'seconds' },
			{ key: 'reading', value: reviews === null ? null : 0, previous: reviews === null ? null : 0, unit: 'seconds' },
			{ key: 'journal', value: reviews === null ? null : 0, previous: reviews === null ? null : 0, unit: 'count' }
		],
		days: Array.from({ length: 7 }, (_, i) => ({
			date: `2026-11-${16 + i}`,
			state: i < 3 ? ('active' as const) : ('upcoming' as const),
			reviews: null,
			points: null
		})),
		previousDays: [],
		daysActive: { active: 3, of: 3, localOnly: reviews === null },
		streak: 4,
		mature: null,
		characters: null,
		goal: null,
		allVacation: false,
		nothingToCompare: false
	};
	return { summary, sources: [], activityError };
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => (resolve = res));
	return { promise, resolve };
}

function select(id: number | null): void {
	ctx.session.workspaces.set({
		list: [],
		current: id === null ? null : ({ id, language: 'zh', name: `w${id}` } as never)
	});
}

const reviewsValue = () => document.querySelector('dd .value')?.textContent;

beforeEach(() => {
	select(1);
	vi.mocked(loadWeek).mockResolvedValue(view());
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('WeeklySummaryWidget', () => {
	it('shows the compact current week and links to the Week tab', async () => {
		const { container } = render(WeeklySummaryWidget, { context: ctx.context });
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		const monday = weekOf(ctx.session.zone.day().today());
		expect(loadWeek).toHaveBeenCalledWith(expect.anything(), 1, monday, { force: false });
		expect([...container.querySelectorAll('dt')].map((t) => t.textContent)).toEqual([
			'Reviews',
			'New cards',
			'Study time',
			'Days active',
			'Streak'
		]);
		expect(screen.getByRole('heading', { name: 'This week' })).toBeTruthy();
		expect(screen.getByRole('link', { name: 'See the week' }).getAttribute('href')).toBe('/stats/week');
		expect(container.querySelectorAll('ol > li')).toHaveLength(7);
		expect(loadWeekCharacters).not.toHaveBeenCalled();
	});

	it('has no link to the Week tab while Stats is switched off; the week still shows (#295)', async () => {
		ctx.session.features.set({ list: [{ id: 'stats', enabled: false }], status: 'ready' });
		render(WeeklySummaryWidget, { context: ctx.context });
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		expect(screen.queryByRole('link', { name: 'See the week' })).toBeNull();
		ctx.session.features.set({ list: [], status: 'idle' });
	});

	it('asks for a workspace without one', async () => {
		select(null);
		render(WeeklySummaryWidget, { context: ctx.context });
		expect(await screen.findByText('Choose a workspace in the header to see your week.')).toBeTruthy();
		expect(loadWeek).not.toHaveBeenCalled();
	});

	it('shows the error with Try again, which forces a reload', async () => {
		vi.mocked(loadWeek).mockRejectedValueOnce(new Error('broken'));
		render(WeeklySummaryWidget, { context: ctx.context });
		const retry = await screen.findByRole('button', { name: 'Try again' });
		retry.click();
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		expect(vi.mocked(loadWeek).mock.calls.at(-1)?.[3]).toEqual({ force: true });
	});

	it('offline: the local rows and a Retry', async () => {
		vi.mocked(loadWeek).mockResolvedValue(view(null, 'You are offline.'));
		render(WeeklySummaryWidget, { context: ctx.context });
		await waitFor(() => expect(reviewsValue()).toBe('Not available offline'));
		expect(screen.getByText('1')).toBeTruthy();
		expect(screen.getByText('10 min (flashcards only)')).toBeTruthy();
		screen.getByRole('button', { name: 'Retry' }).click();
		await waitFor(() => expect(vi.mocked(loadWeek).mock.calls.at(-1)?.[3]).toEqual({ force: true }));
	});

	it('drops a stale answer after a workspace switch', async () => {
		const first = deferred<WeekView>();
		const second = deferred<WeekView>();
		vi.mocked(loadWeek).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		render(WeeklySummaryWidget, { context: ctx.context });
		await tick();
		select(2);
		await tick();
		second.resolve(view(22));
		await waitFor(() => expect(reviewsValue()).toBe('22'));
		first.resolve(view(11));
		await tick();
		await Promise.resolve();
		expect(reviewsValue()).toBe('22');
	});

	it('reloads when the learner day changes', async () => {
		render(WeeklySummaryWidget, { context: ctx.context });
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		vi.mocked(loadWeek).mockResolvedValueOnce(view(30));
		vi.mocked(onContextStale).mock.calls[0][1]();
		await waitFor(() => expect(reviewsValue()).toBe('30'));
	});
});
