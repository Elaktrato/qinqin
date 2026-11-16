import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/weekly/loadWeek', () => ({ loadWeek: vi.fn(), loadWeekCharacters: vi.fn() }));
vi.mock('$lib/study/currentContext', () => ({ onContextStale: vi.fn(() => () => {}) }));
vi.mock('$lib/events', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/events')>()),
	onEventLogChange: vi.fn(() => () => {})
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	onStudyWrite: vi.fn(() => () => {})
}));

import { goto } from '$app/navigation';
import { onEventLogChange } from '$lib/events';
import { onContextStale } from '$lib/study/currentContext';
import { onStudyWrite } from '$lib/study/store';
import { setUrl } from '$lib/testing/appState.svelte';
import { loadWeek, loadWeekCharacters, type WeekView } from '$lib/weekly/loadWeek';
import type { WeekSummary } from '$lib/weekly/summary';
import { oldestWeek } from '$lib/weekly/week';
import { workspaces } from '$lib/workspaces';
import Page from './+page.svelte';

const NOW = new Date('2026-11-18T12:00:00Z');

function view(monday: string, reviews = 12): WeekView {
	const summary: WeekSummary = {
		monday,
		today: '2026-11-18',
		inProgress: monday === '2026-11-16',
		compareThrough: '2026-11-11',
		rows: [{ key: 'reviews', value: reviews, previous: 0, unit: 'count' }],
		days: [],
		daysActive: { active: 1, of: 3, localOnly: false },
		streak: 1,
		mature: null,
		characters: null,
		goal: null,
		allVacation: false,
		nothingToCompare: true
	};
	return { summary, sources: [], activityError: null };
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => (resolve = res));
	return { promise, resolve };
}

function select(id: number, language = 'zh'): void {
	workspaces.set({ list: [], current: { id, language, name: `w${id}` } as never });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setUrl('/stats/week');
	select(1);
	vi.mocked(loadWeek).mockImplementation(async (_ws, monday) => view(monday));
	vi.mocked(loadWeekCharacters).mockResolvedValue({ value: 3, previous: 1 });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.useRealTimers();
});

const reviewsValue = () => document.querySelector('dd .value')?.textContent;

describe('Stats week page', () => {
	it('shows the current week without a parameter, a previous link and no next link', async () => {
		render(Page);
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		expect(loadWeek).toHaveBeenCalledWith(1, '2026-11-16', { detail: true, force: false });
		const heading = screen.getByRole('heading', { level: 2 });
		expect(heading.textContent).toMatch(/^This week \(.*16.*22.*2026\)$/);
		expect(heading.getAttribute('aria-live')).toBe('polite');
		const prev = screen.getByRole('link', { name: 'Previous week' });
		expect(prev.getAttribute('href')).toBe('/stats/week?week=2026-11-09');
		expect(prev.hasAttribute('data-sveltekit-keepfocus')).toBe(true);
		expect(screen.queryByRole('link', { name: 'Next week' })).toBeNull();
		expect(goto).not.toHaveBeenCalled();
	});

	it('links both ways from a completed week', async () => {
		setUrl('/stats/week?week=2026-11-09');
		render(Page);
		await waitFor(() => expect(loadWeek).toHaveBeenCalledWith(1, '2026-11-09', expect.anything()));
		expect(screen.getByRole('link', { name: 'Next week' }).getAttribute('href')).toBe('/stats/week');
		expect(screen.getByRole('link', { name: 'Previous week' }).getAttribute('href')).toBe('/stats/week?week=2026-11-02');
	});

	it.each([
		['a weekday', '2026-11-11', '/stats/week?week=2026-11-09'],
		['a future week', '2026-12-07', '/stats/week'],
		['too old', '2020-01-06', `/stats/week?week=${oldestWeek('2026-11-18')}`],
		['garbage', 'garbage', '/stats/week']
	])('normalises %s with a replaced history entry', async (_n, param, href) => {
		setUrl(`/stats/week?week=${param}`);
		render(Page);
		await waitFor(() => expect(goto).toHaveBeenCalled());
		expect(vi.mocked(goto).mock.calls[0]).toEqual([href, { replaceState: true, keepFocus: true, noScroll: true }]);
	});

	it('has no previous link on the oldest week', async () => {
		setUrl(`/stats/week?week=${oldestWeek('2026-11-18')}`);
		render(Page);
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		expect(screen.queryByRole('link', { name: 'Previous week' })).toBeNull();
	});

	it('reloads on a workspace switch and drops the stale answer', async () => {
		const first = deferred<WeekView>();
		const second = deferred<WeekView>();
		vi.mocked(loadWeek).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		render(Page);
		await tick();
		select(2);
		await tick();
		expect(loadWeek).toHaveBeenLastCalledWith(2, '2026-11-16', expect.anything());
		second.resolve(view('2026-11-16', 22));
		await waitFor(() => expect(reviewsValue()).toBe('22'));
		first.resolve(view('2026-11-16', 11));
		await tick();
		await Promise.resolve();
		expect(reviewsValue()).toBe('22');
	});

	it('reloads when the learner day changes', async () => {
		render(Page);
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		const listener = vi.mocked(onContextStale).mock.calls[0][0];
		vi.mocked(loadWeek).mockResolvedValueOnce(view('2026-11-16', 30));
		listener();
		await waitFor(() => expect(reviewsValue()).toBe('30'));
	});

	it('renders the characters after the rest', async () => {
		const chars = deferred<{ value: number; previous: number } | null>();
		vi.mocked(loadWeekCharacters).mockReturnValueOnce(chars.promise);
		render(Page);
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		expect(screen.getByText('Counting characters…')).toBeTruthy();
		chars.resolve({ value: 3, previous: 1 });
		await waitFor(() => expect(screen.getByText('Characters learned')).toBeTruthy());
		expect(screen.queryByText('Counting characters…')).toBeNull();
		expect(loadWeekCharacters).toHaveBeenCalledWith(1, 'zh', '2026-11-16', { force: false });
	});

	it('does not count characters outside Han languages', async () => {
		select(1, 'es');
		render(Page);
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		expect(loadWeekCharacters).not.toHaveBeenCalled();
		expect(screen.queryByText('Counting characters…')).toBeNull();
	});

	it('keeps the shown week’s heading, busy and dimmed, until the next week has loaded', async () => {
		render(Page);
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		const next = deferred<WeekView>();
		vi.mocked(loadWeek).mockReturnValueOnce(next.promise);
		setUrl('/stats/week?week=2026-11-09');
		await tick();
		const heading = screen.getByRole('heading', { level: 2 });
		expect(heading.textContent).toMatch(/^This week/);
		const body = document.querySelector('.week-body')!;
		expect(body.getAttribute('aria-busy')).toBe('true');
		expect(body.classList.contains('stale')).toBe(true);
		next.resolve(view('2026-11-09', 5));
		await waitFor(() => expect(reviewsValue()).toBe('5'));
		expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/^Last week/);
		expect(body.getAttribute('aria-busy')).toBe('false');
		expect(document.querySelector('.week-body')!.classList.contains('stale')).toBe(false);
	});

	it('reloads after a review is posted or study data is written in this workspace', async () => {
		render(Page);
		await waitFor(() => expect(reviewsValue()).toBe('12'));
		const onLog = vi.mocked(onEventLogChange).mock.calls[0][0];
		const onWrite = vi.mocked(onStudyWrite).mock.calls[0][0];
		const calls = vi.mocked(loadWeek).mock.calls.length;
		onLog(2);
		await tick();
		expect(vi.mocked(loadWeek).mock.calls.length).toBe(calls);
		vi.mocked(loadWeek).mockResolvedValueOnce(view('2026-11-16', 13));
		onLog(1);
		await waitFor(() => expect(reviewsValue()).toBe('13'));
		vi.mocked(loadWeek).mockResolvedValueOnce(view('2026-11-16', 14));
		onWrite(0);
		await waitFor(() => expect(reviewsValue()).toBe('14'));
	});

	it('marks the characters unavailable when their load fails (offline)', async () => {
		vi.mocked(loadWeekCharacters).mockRejectedValueOnce(new Error('offline'));
		render(Page);
		await waitFor(() => expect(screen.getByText('Characters learned')).toBeTruthy());
		expect(screen.getByText('Not available offline')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});
});

