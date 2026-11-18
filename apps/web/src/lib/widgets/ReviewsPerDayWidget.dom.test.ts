import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn() }));
vi.mock('$lib/stats/summary', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/stats/summary')>()),
	reviewsPerDay: vi.fn()
}));
vi.mock('$lib/study/currentContext', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/currentContext')>()),
	onContextStale: vi.fn(() => () => {})
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	onStudyWrite: vi.fn(() => () => {})
}));
vi.mock('$lib/events', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/events')>()),
	onEventLogChange: vi.fn(() => () => {})
}));

import { onEventLogChange } from '$lib/events';
import { loadStudyHistory } from '$lib/study/history';
import { reviewsPerDay, type ReviewDay } from '$lib/stats/summary';
import { pluginStates } from '$lib/plugins/states';
import { workspaces } from '$lib/workspaces';
import ReviewsPerDayWidget from './ReviewsPerDayWidget.svelte';

/** 30 days from 20 October; `counts` gives the days that have reviews. */
function series(counts: Record<string, number>, today = '2026-11-18'): ReviewDay[] {
	return Array.from({ length: 30 }, (_, i) => {
		const date = new Date(Date.UTC(2026, 9, 20 + i)).toISOString().slice(0, 10);
		return { day: date, count: counts[date] ?? 0, today: date === today };
	});
}

const announced = (container: HTMLElement): number => container.querySelectorAll('.chart [data-day]').length;

function select(id: number | null): void {
	workspaces.set({
		list: [],
		current: id === null ? null : ({ id, language: 'zh', name: `w${id}` } as never)
	});
}

function flashcards(enabled: boolean): void {
	pluginStates.set({
		list: [{ id: 'qinqin-flashcards', manifest: {}, enabled, order: 0 }],
		status: 'ready'
	});
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => (resolve = res));
	return { promise, resolve };
}

beforeEach(() => {
	select(1);
	flashcards(true);
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(reviewsPerDay).mockReturnValue(series({ '2026-11-17': 21, '2026-11-18': 7 }));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
	pluginStates.set({ list: [], status: 'idle' });
});

describe('ReviewsPerDayWidget', () => {
	it('thirty decorative columns and a visually hidden list of the days with reviews', async () => {
		const { container } = render(ReviewsPerDayWidget);
		await waitFor(() => expect(announced(container)).toBe(30));

		expect(container.querySelectorAll('.chart [data-day]')).toHaveLength(30);
		expect(container.querySelectorAll('.chart .bar')).toHaveLength(2);
		const list = container.querySelectorAll('ul.sr-only li');
		expect([...list].map((li) => li.textContent)).toEqual([
			'17 Nov: 21 reviews',
			'18 Nov: 7 reviews, today'
		]);
		expect(container.querySelector('.chart')?.getAttribute('aria-hidden')).toBe('true');
	});

	it('today’s bar is marked today in its text and carries the today class', async () => {
		const { container } = render(ReviewsPerDayWidget);
		await waitFor(() => expect(announced(container)).toBe(30));

		const bar = container.querySelector('.bar.today') as HTMLElement;
		expect(bar).not.toBeNull();
		expect(bar.closest('[data-day]')?.getAttribute('title')).toContain('today');
		expect(container.querySelector('[data-day="2026-11-18"]')?.getAttribute('title')).toBe(
			'18 Nov: 7 reviews, today'
		);
		expect(container.querySelector('[data-day="2026-11-17"]')?.getAttribute('title')).toBe('17 Nov: 21 reviews');
	});

	it('the visible summary counts the total and today', async () => {
		render(ReviewsPerDayWidget);
		expect(await screen.findByText('28 reviews in the last 30 days, 7 today')).toBeTruthy();
	});

	it('bar heights are relative to the busiest day; a day with 0 has no bar but keeps its column', async () => {
		const { container } = render(ReviewsPerDayWidget);
		await waitFor(() => expect(announced(container)).toBe(30));

		const busiest = container.querySelector('[data-day="2026-11-17"] .bar') as HTMLElement;
		const today = container.querySelector('[data-day="2026-11-18"] .bar') as HTMLElement;
		const zero = container.querySelector('[data-day="2026-11-16"]') as HTMLElement;
		expect(busiest.style.height).toBe('100%');
		expect(parseFloat(today.style.height)).toBeCloseTo((7 / 21) * 100, 5);
		expect(zero.querySelector('.bar')).toBeNull();
		expect(zero.getAttribute('data-day')).toBe('2026-11-16');
		expect(zero.getAttribute('title')).toBe('16 Nov: 0 reviews');
	});

	it('an empty month shows the empty state', async () => {
		vi.mocked(reviewsPerDay).mockReturnValue(series({}));
		const { container } = render(ReviewsPerDayWidget);
		expect(await screen.findByText('No reviews in the last 30 days.')).toBeTruthy();
		expect(container.querySelector('.chart')).toBeNull();
	});

	it('flashcards switched off shows the note, not historical reviews', async () => {
		flashcards(false);
		const { container } = render(ReviewsPerDayWidget);

		expect(
			await screen.findByText('Switch on flashcards in Settings → Features to see these numbers.')
		).toBeTruthy();
		expect(container.querySelector('.chart')).toBeNull();
		expect(loadStudyHistory).not.toHaveBeenCalled();
	});

	it('reloads on a posted review for this workspace', async () => {
		render(ReviewsPerDayWidget);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(1));
		const onLog = vi.mocked(onEventLogChange).mock.calls.at(-1)![0];

		onLog(2);
		await tick();
		expect(loadStudyHistory).toHaveBeenCalledTimes(1);
		onLog(1);
		await waitFor(() => expect(loadStudyHistory).toHaveBeenCalledTimes(2));
	});

	it('a slow earlier load never overwrites a newer one', async () => {
		const first = deferred<never>();
		const second = deferred<never>();
		vi.mocked(loadStudyHistory).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const { container } = render(ReviewsPerDayWidget);
		await tick();
		select(2);
		await tick();
		vi.mocked(reviewsPerDay).mockReturnValue(series({ '2026-11-18': 5 }));
		second.resolve({ decks: [], cards: [], reviews: [], merged: 0 } as never);
		await waitFor(() => expect(screen.getByText('5 reviews in the last 30 days, 5 today')).toBeTruthy());
		first.resolve({ decks: [], cards: [], reviews: [], merged: 0 } as never);
		await tick();
		await Promise.resolve();
		expect(screen.getByText('5 reviews in the last 30 days, 5 today')).toBeTruthy();
		expect(container.querySelector('.chart')).not.toBeNull();
	});

	it('asks for a workspace without one, and shows errors with Try again', async () => {
		select(null);
		render(ReviewsPerDayWidget);
		expect(await screen.findByText('Choose a workspace in the header.')).toBeTruthy();
		expect(loadStudyHistory).not.toHaveBeenCalled();

		cleanup();
		select(1);
		vi.mocked(loadStudyHistory).mockRejectedValueOnce(new Error('broken'));
		render(ReviewsPerDayWidget);
		expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
		expect(screen.getByText('broken')).toBeTruthy();
	});

	it('keeps only the days with reviews in the list and the first, middle and last axis labels', async () => {
		const { container } = render(ReviewsPerDayWidget);
		await waitFor(() => expect(announced(container)).toBe(30));
		const axis = [...container.querySelectorAll('.axis span')].map((s) => s.textContent);
		expect(axis).toEqual([
			expect.stringContaining('20 Oct'),
			expect.stringMatching(/3 Nov|4 Nov/),
			expect.stringContaining('18 Nov')
		]);
	});
});
