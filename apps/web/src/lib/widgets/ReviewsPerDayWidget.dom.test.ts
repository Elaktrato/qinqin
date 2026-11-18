import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
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

import { loadStudyHistory } from '$lib/study/history';
import { reviewsPerDay, type ReviewDay } from '$lib/stats/summary';
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

beforeEach(() => {
	select(1);
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(reviewsPerDay).mockReturnValue(series({ '2026-11-17': 21, '2026-11-18': 7 }));
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
});

describe('ReviewsPerDayWidget', () => {
	it('thirty decorative bars and a visually hidden list of the days with reviews', async () => {
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
