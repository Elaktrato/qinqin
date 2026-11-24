import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/weekly/loadWeek', () => ({ loadWeek: vi.fn(), loadWeekCharacters: vi.fn() }));
vi.mock('$lib/milestones/loadMilestones', () => ({ loadMilestones: vi.fn(), markSeen: vi.fn() }));
vi.mock('$lib/study/currentContext', () => ({ onContextStale: vi.fn(() => () => {}) }));
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	onStudyChange: vi.fn(() => () => {})
}));

import { goto } from '$app/navigation';
import { fireEvent, within } from '@testing-library/svelte';
import { loadMilestones, markSeen, type MilestonesView } from '$lib/milestones/loadMilestones';
import { givenTimelines } from '$lib/weekly/replay';
import { onContextStale } from '$lib/study/currentContext';
import { onStudyChange } from '$lib/study/data';
import { setUrl } from '$lib/testing/appState.svelte';
import { loadWeek, loadWeekCharacters, type WeekView } from '$lib/weekly/loadWeek';
import type { WeekSummary } from '$lib/weekly/summary';
import { oldestWeek } from '$lib/weekly/week';
import Page from './+page.svelte';

// The session's event log (record 0009): its methods, faked on the class.
let onEventLogChange!: MockInstance<EventLog['onChange']>;
beforeEach(() => {
	onEventLogChange = vi.spyOn(EventLog.prototype, 'onChange').mockImplementation((() => () => {}) as never);
});

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const NOW = new Date('2026-11-18T12:00:00Z');

function view(monday: string, reviews = 12): WeekView {
	const summary: WeekSummary = {
		monday,
		today: '2026-11-18',
		inProgress: monday === '2026-11-16',
		compareThrough: '2026-11-11',
		rows: [{ key: 'reviews', value: reviews, previous: 0, unit: 'count' }],
		days: [],
		previousDays: [],
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
	ctx.session.workspaces.set({ list: [], current: { id, language, name: `w${id}` } as never });
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setUrl('/stats/week');
	select(1);
	vi.mocked(loadWeek).mockImplementation(async (_study, _ws, monday) => view(monday));
	vi.mocked(loadWeekCharacters).mockResolvedValue({ value: 3, previous: 1 } as never);
	vi.mocked(loadMilestones).mockResolvedValue(noMilestones());
	vi.mocked(markSeen).mockResolvedValue(undefined);
});

function noMilestones(): MilestonesView {
	return { plan: { kind: 'none' }, history: [], titles: new Map(), reached: [], live: new Map(), workspaceId: 1 };
}

function someMilestones(title = '100 reviews'): MilestonesView {
	const r = { id: 'reviews:100', at: Date.parse('2026-11-17T09:00:00Z'), day: '2026-11-17' };
	return {
		plan: { kind: 'recent', items: [r], ids: ['reviews:100'] },
		history: [
			{ id: 'reviews:100', day: '2026-11-17', isNew: true },
			{ id: 'streak:3', day: '2026-11-02', isNew: false }
		],
		titles: new Map([
			['reviews:100', title],
			['streak:3', '3-day streak']
		]),
		reached: [r],
		live: new Map(),
		workspaceId: 1
	};
}
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.useRealTimers();
});

const firstValue = () => document.querySelector('.stats .value')?.textContent;

describe('Stats week page', () => {
	it('shows the current week without a parameter; Previous is enabled and Next disabled, both named and tooltipped', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		expect(loadWeek).toHaveBeenCalledWith(expect.anything(), 1, '2026-11-16', { detail: true, force: false });
		const heading = screen.getByRole('heading', { level: 2, name: /week/i });
		expect(heading.textContent).toMatch(/^This week \(.*16.*22.*2026\)$/);
		expect(heading.getAttribute('aria-live')).toBe('polite');
		const prev = screen.getByRole('button', { name: 'Previous week' }) as HTMLButtonElement;
		const next = screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement;
		expect(prev.disabled).toBe(false);
		expect(next.disabled).toBe(true);
		expect(prev.closest('.tooltip-anchor')?.querySelector('[role="tooltip"]')?.textContent).toBe('Previous week');
		expect(next.closest('.tooltip-anchor')?.querySelector('[role="tooltip"]')?.textContent).toBe('Next week');
		expect(screen.queryByRole('link', { name: 'Previous week' })).toBeNull();
		expect(goto).not.toHaveBeenCalled();
	});

	it('both arrows page to the neighbouring weeks from a completed week', async () => {
		setUrl('/stats/week?week=2026-11-09');
		render(Page, { context: ctx.context });
		await waitFor(() => expect(loadWeek).toHaveBeenCalledWith(expect.anything(), 1, '2026-11-09', expect.anything()));
		const prev = screen.getByRole('button', { name: 'Previous week' });
		const next = screen.getByRole('button', { name: 'Next week' });
		expect((prev as HTMLButtonElement).disabled).toBe(false);
		expect((next as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(next);
		expect(goto).toHaveBeenCalledWith('/stats/week', { keepFocus: true, noScroll: true });
		await fireEvent.click(prev);
		expect(goto).toHaveBeenCalledWith('/stats/week?week=2026-11-02', { keepFocus: true, noScroll: true });
	});

	it('pressing Previous goes to ?week=<monday−7> and asks goto to keep the focus', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		const prev = screen.getByRole('button', { name: 'Previous week' }) as HTMLButtonElement;
		prev.focus();
		await fireEvent.click(prev);
		expect(goto).toHaveBeenCalledWith('/stats/week?week=2026-11-09', { keepFocus: true, noScroll: true });
		expect(document.activeElement).toBe(prev);
	});

	it.each([
		['a weekday', '2026-11-11', '/stats/week?week=2026-11-09'],
		['a future week', '2026-12-07', '/stats/week'],
		['too old', '2020-01-06', `/stats/week?week=${oldestWeek('2026-11-18')}`],
		['garbage', 'garbage', '/stats/week']
	])('normalises %s with a replaced history entry', async (_n, param, href) => {
		setUrl(`/stats/week?week=${param}`);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(goto).toHaveBeenCalled());
		expect(vi.mocked(goto).mock.calls[0]).toEqual([href, { replaceState: true, keepFocus: true, noScroll: true }]);
	});

	it('disables Previous on the oldest browsable week', async () => {
		setUrl(`/stats/week?week=${oldestWeek('2026-11-18')}`);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		expect((screen.getByRole('button', { name: 'Previous week' }) as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(false);
	});

	it('reloads on a workspace switch and drops the stale answer', async () => {
		const first = deferred<WeekView>();
		const second = deferred<WeekView>();
		vi.mocked(loadWeek).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		render(Page, { context: ctx.context });
		await tick();
		select(2);
		await tick();
		expect(loadWeek).toHaveBeenLastCalledWith(expect.anything(), 2, '2026-11-16', expect.anything());
		second.resolve(view('2026-11-16', 22));
		await waitFor(() => expect(firstValue()).toBe('22'));
		first.resolve(view('2026-11-16', 11));
		await tick();
		await Promise.resolve();
		expect(firstValue()).toBe('22');
	});

	it('reloads when the learner day changes', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		const listener = vi.mocked(onContextStale).mock.calls[0][0];
		vi.mocked(loadWeek).mockResolvedValueOnce(view('2026-11-16', 30));
		listener();
		await waitFor(() => expect(firstValue()).toBe('30'));
	});

	it('renders the characters after the rest', async () => {
		const chars = deferred<{ value: number; previous: number } | null>();
		vi.mocked(loadWeekCharacters).mockReturnValueOnce(chars.promise as never);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		expect(screen.getByText('Counting characters…')).toBeTruthy();
		chars.resolve({ value: 3, previous: 1 });
		await waitFor(() => expect(screen.getByText('Characters learned')).toBeTruthy());
		expect(screen.queryByText('Counting characters…')).toBeNull();
		expect(loadWeekCharacters).toHaveBeenCalledWith(expect.anything(), 1, 'zh', '2026-11-16', { force: false });
	});

	it('does not count characters outside Han languages', async () => {
		select(1, 'es');
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		expect(loadWeekCharacters).not.toHaveBeenCalled();
		expect(screen.queryByText('Counting characters…')).toBeNull();
	});

	it('keeps the shown week’s heading, busy and dimmed, until the next week has loaded', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		const next = deferred<WeekView>();
		vi.mocked(loadWeek).mockReturnValueOnce(next.promise);
		setUrl('/stats/week?week=2026-11-09');
		await tick();
		const heading = screen.getByRole('heading', { level: 2, name: /week/i });
		expect(heading.textContent).toMatch(/^This week/);
		const body = document.querySelector('.week-body')!;
		expect(body.getAttribute('aria-busy')).toBe('true');
		expect(body.classList.contains('stale')).toBe(true);
		next.resolve(view('2026-11-09', 5));
		await waitFor(() => expect(firstValue()).toBe('5'));
		expect(screen.getByRole('heading', { level: 2, name: /week/i }).textContent).toMatch(/^Last week/);
		expect(body.getAttribute('aria-busy')).toBe('false');
		expect(document.querySelector('.week-body')!.classList.contains('stale')).toBe(false);
	});

	it('reloads after a review is posted or study data is written in this workspace', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(firstValue()).toBe('12'));
		const onLog = vi.mocked(onEventLogChange).mock.calls[0][0];
		const onWrite = vi.mocked(onStudyChange).mock.calls[0][1];
		const calls = vi.mocked(loadWeek).mock.calls.length;
		onLog(2);
		await tick();
		expect(vi.mocked(loadWeek).mock.calls.length).toBe(calls);
		vi.mocked(loadWeek).mockResolvedValueOnce(view('2026-11-16', 13));
		onLog(1);
		await waitFor(() => expect(firstValue()).toBe('13'));
		vi.mocked(loadWeek).mockResolvedValueOnce(view('2026-11-16', 14));
		onWrite(0);
		await waitFor(() => expect(firstValue()).toBe('14'));
	});

	it('marks the characters unavailable when their load fails (offline)', async () => {
		vi.mocked(loadWeekCharacters).mockRejectedValueOnce(new Error('offline'));
		render(Page, { context: ctx.context });
		await waitFor(() => expect(screen.getByText('Characters learned')).toBeTruthy());
		expect(screen.getByText('Not available offline')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
	});

	describe('milestones', () => {
		it('loads every family with the tab\'s timelines and universe: card above the summary, history below', async () => {
			const timelines = givenTimelines({});
			const universe = { chars: [{ i: 1, c: '好' }], cards: [], timelines };
			vi.mocked(loadWeek).mockImplementation(async (_study, _ws, monday) => ({ ...view(monday), timelines }));
			vi.mocked(loadWeekCharacters).mockResolvedValue({ value: 3, previous: 1, universe } as never);
			vi.mocked(loadMilestones).mockResolvedValue(someMilestones());
			render(Page, { context: ctx.context });
			await waitFor(() => expect(screen.getByRole('heading', { level: 3, name: 'Milestone reached' })).toBeTruthy());
			// Inside the week's section (h2), below its heading; the history keeps its own h2.
			expect(screen.getByRole('heading', { level: 3, name: 'Milestone reached' }).closest('section.week')).not.toBeNull();
			expect(loadMilestones).toHaveBeenCalledWith(expect.anything(), 1, {
				states: expect.anything(),
				scope: 'week',
				language: 'zh',
				week: { timelines, chars: universe.chars, cards: universe.cards }
			});
			const card = document.querySelector('.milestone-card')!;
			const summary = document.querySelector('.week-summary')!;
			expect(card.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
			const history = document.getElementById('milestones')!;
			expect(history.querySelector('h2')?.textContent).toBe('Milestones');
			const items = [...history.querySelectorAll('ol li')].map((li) => ({
				title: li.querySelector('.title')?.textContent,
				date: li.querySelector('.date')?.textContent,
				isNew: li.querySelector('.new')?.textContent ?? null
			}));
			expect(items).toEqual([
				{ title: '100 reviews', date: 'reached 17 November 2026', isNew: 'New' },
				{ title: '3-day streak', date: 'reached 2 November 2026', isNew: null }
			]);
			// The week's own line: only the item of the shown week.
			expect(document.querySelector('.milestone-line')?.textContent).toBe('Milestone this week: 100 reviews');
		});

		it('the status region is there before the week loads; the card sits outside it', async () => {
			const later = deferred<WeekView>();
			vi.mocked(loadWeek).mockReturnValueOnce(later.promise);
			vi.mocked(loadMilestones).mockResolvedValue(someMilestones());
			render(Page, { context: ctx.context });
			const status = document.querySelector('.milestone-status[role="status"]')!;
			expect(status).not.toBeNull();
			later.resolve(view('2026-11-16'));
			const button = await screen.findByRole('button', { name: 'Dismiss' });
			expect(document.querySelector('.milestone-status[role="status"]')).toBe(status);
			expect(status.textContent).toBe('Milestone reached: 100 reviews');
			expect(status.contains(button)).toBe(false);
		});

		it('outside Han languages the universe is null', async () => {
			select(1, 'es');
			const timelines = givenTimelines({});
			vi.mocked(loadWeek).mockImplementation(async (_study, _ws, monday) => ({ ...view(monday), timelines }));
			render(Page, { context: ctx.context });
			await waitFor(() => expect(loadMilestones).toHaveBeenCalled());
			expect(loadMilestones).toHaveBeenCalledWith(expect.anything(), 1, { scope: 'week', language: 'es', states: expect.anything(), week: { timelines, chars: null } });
		});

		it('Dismiss hides the card and marks the covered milestones', async () => {
			const ms = someMilestones();
			vi.mocked(loadMilestones).mockResolvedValue(ms);
			render(Page, { context: ctx.context });
			const button = await screen.findByRole('button', { name: 'Dismiss' });
			await fireEvent.click(button);
			expect(markSeen).toHaveBeenCalledWith(expect.anything(), ms);
			expect(screen.queryByRole('heading', { name: 'Milestone reached' })).toBeNull();
			// The history stays.
			expect(document.getElementById('milestones')).not.toBeNull();
		});

		it('a workspace switch removes the old card at once', async () => {
			vi.mocked(loadMilestones).mockResolvedValue(someMilestones());
			render(Page, { context: ctx.context });
			await screen.findByRole('button', { name: 'Dismiss' });
			const next = deferred<WeekView>();
			vi.mocked(loadWeek).mockReturnValueOnce(next.promise);
			select(2);
			await tick();
			expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
			expect(markSeen).not.toHaveBeenCalled();
		});

		it('a workspace switch drops a stale milestones answer', async () => {
			const first = deferred<MilestonesView>();
			vi.mocked(loadMilestones).mockReturnValueOnce(first.promise).mockResolvedValue(someMilestones('from workspace 2'));
			render(Page, { context: ctx.context });
			await waitFor(() => expect(loadMilestones).toHaveBeenCalledTimes(1));
			select(2);
			await waitFor(() => expect(screen.getByText(/^from workspace 2, reached/, { selector: '.milestone-card li' })).toBeTruthy());
			first.resolve(someMilestones('from workspace 1'));
			await tick();
			await Promise.resolve();
			expect(screen.queryByText(/from workspace 1/)).toBeNull();
		});

		it('a study write in the workspace (another dismiss) loads them again', async () => {
			render(Page, { context: ctx.context });
			await waitFor(() => expect(loadMilestones).toHaveBeenCalledTimes(1));
			vi.mocked(loadMilestones).mockResolvedValue(someMilestones());
			vi.mocked(onStudyChange).mock.calls[0][1](1);
			await waitFor(() => expect(screen.getByRole('heading', { name: 'Milestone reached' })).toBeTruthy());
		});
	});
});
