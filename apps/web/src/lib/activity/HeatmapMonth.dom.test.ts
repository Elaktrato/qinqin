import { StudyDays } from '$lib/time/studyDays';
import type { MockInstance } from 'vitest';
import { studyDay as studyDayOf } from '$lib/time/studyDay';
/** One rule object, as the session's StudyDays caches it. */
const SHARED_DAY = studyDayOf([]);
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/stats', () => ({ fetchActivity: vi.fn() }));
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

import { fetchActivity, type ActivityResponse } from '$lib/api/stats';
import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte';
import { loadStudyHistory, getStudyData } from '$lib/study/data';
import { studyDay } from '$lib/time/studyDay';

// The session's StudyDays (record 0009): its methods, faked on the class.
let currentStudyDay!: MockInstance<StudyDays['day']>;
let onStudyDayChange!: MockInstance<StudyDays['onChange']>;
beforeEach(() => {
	currentStudyDay = vi.spyOn(StudyDays.prototype, 'day').mockImplementation((() => SHARED_DAY) as never);
	onStudyDayChange = vi.spyOn(StudyDays.prototype, 'onChange').mockImplementation((() => () => {}) as never);
});

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const WS = { id: 3, language: 'zh', name: 'zh' } as never;
const REVIEWS = {
	type: 'review',
	plugin: 'flashcards',
	label: 'Reviews',
	unit: 'count' as const,
	describe: { one: 'flashcard review', other: 'flashcard reviews' }
};

function reply(from: string, to: string, cells: ActivityResponse['cells'] = []): ActivityResponse {
	return { from, to, timeZone: 'UTC', sources: [REVIEWS], cells };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-16T12:00:00Z'));
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(onStudyDayChange).mockReturnValue(() => {});
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(fetchActivity).mockImplementation(async (from, to) => reply(from, to));
	ctx.session.workspaces.set({ list: [WS], current: WS });
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

const monthName = () => document.querySelector('.month-name');

describe('HeatmapMonth', () => {
	it('shows the current month with weekday headings and date numbers', async () => {
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		expect(vi.mocked(fetchActivity)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(fetchActivity).mock.calls[0]).toEqual(['2026-11-01', '2026-11-16']);
		const heads = [...document.querySelectorAll('.month-grid .wd')].map((e) => e.textContent);
		expect(heads).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
		const numbers = [...document.querySelectorAll('.month-grid .dn')].map((e) => e.textContent);
		expect(numbers).toHaveLength(30);
		expect(numbers[0]).toBe('1');
		expect(numbers[29]).toBe('30');
		// 1 Nov 2026 is a Sunday: six blanks first.
		expect(document.querySelectorAll('.month-grid .blank').length).toBeGreaterThanOrEqual(6);
		expect(monthName()?.getAttribute('aria-live')).toBe('polite');
	});

	it("Previous loads the previous month's window and announces the new month", async () => {
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
		await waitFor(() => expect(monthName()?.textContent).toBe('October 2026'));
		expect(vi.mocked(fetchActivity).mock.calls[1]).toEqual(['2026-10-01', '2026-10-31']);
		expect(document.querySelectorAll('.month-grid .dn')).toHaveLength(31);
		expect(document.querySelectorAll('.month-grid .future')).toHaveLength(0);
	});

	it('Next is disabled in the current month; Previous is disabled at the earliest month', async () => {
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		const next = screen.getByRole('button', { name: 'Next month' });
		const prev = screen.getByRole('button', { name: 'Previous month' });
		expect(next.hasAttribute('disabled')).toBe(true);
		for (let i = 0; i < 12; i++) await fireEvent.click(prev);
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2025'));
		expect(prev.hasAttribute('disabled')).toBe(true);
		expect(next.hasAttribute('disabled')).toBe(false);
		await fireEvent.click(next);
		await waitFor(() => expect(monthName()?.textContent).toBe('December 2025'));
	});

	it('future days are outlined, not tinted', async () => {
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		const future = [...document.querySelectorAll('.month-grid .tile.future')];
		expect(future).toHaveLength(14);
		expect(future.every((el) => !/level-[1-4]/.test(el.className))).toBe(true);
		expect(document.querySelector('.month-grid .tile.today')?.getAttribute('data-day')).toBe('2026-11-16');
	});

	it('a slow earlier page never overwrites a newer one', async () => {
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		let releaseOctober: (r: ActivityResponse) => void = () => {};
		vi.mocked(fetchActivity)
			.mockImplementationOnce(() => new Promise((resolve) => (releaseOctober = resolve)))
			.mockImplementationOnce(async (from, to) => reply(from, to));
		const prev = screen.getByRole('button', { name: 'Previous month' });
		await fireEvent.click(prev);
		await fireEvent.click(prev);
		await waitFor(() => expect(monthName()?.textContent).toBe('September 2026'));
		releaseOctober(reply('2026-10-01', '2026-10-31'));
		await new Promise((r) => setTimeout(r, 0));
		expect(monthName()?.textContent).toBe('September 2026');
	});

	it('the summary line counts goal days met in the month only when a goal exists', async () => {
		const { unmount } = render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		expect(screen.queryByText(/Goal reached on/)).toBeNull();
		unmount();

		vi.mocked(loadStudyHistory).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0,
			goals: { version: 1, showStreak: true, history: [{ from: '2026-11-10', metric: 'activity:review', target: 5 }] }
		});
		vi.mocked(fetchActivity).mockImplementation(async (from, to) =>
			reply(from, to, [
				{ day: '2026-11-10', workspace: 3, type: 'review', points: 5, raw: 5 },
				{ day: '2026-11-11', workspace: 3, type: 'review', points: 9, raw: 9 },
				{ day: '2026-11-12', workspace: 3, type: 'review', points: 1, raw: 1 }
			])
		);
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		// 10..15 November: six past goal days, two met; today (open) does not count yet.
		expect(await screen.findByText('Goal reached on 2 of 6 days')).toBeTruthy();
		const list = screen.getByRole('list', { name: 'Daily activity' });
		expect(within(list).getAllByRole('listitem').length).toBe(7);
	});

	it('switching from the garden shows a loading state, not the 13-week window, until the month arrives (#100 review)', async () => {
		const { rerender } = render(ActivityHeatmap, { props: { layout: 'garden' }, context: ctx.context });
		await waitFor(() => expect(document.querySelector('.grid')).not.toBeNull());
		let release: (r: ActivityResponse) => void = () => {};
		vi.mocked(fetchActivity).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
		await rerender({ layout: 'month' });
		expect(document.querySelector('.month-grid')).toBeNull();
		expect(screen.getByText('Loading activity…')).toBeTruthy();
		release(reply('2026-11-01', '2026-11-16'));
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
	});

	it('a failed month fetch says so with Try again instead of showing another window', async () => {
		const { rerender } = render(ActivityHeatmap, { props: { layout: 'garden' }, context: ctx.context });
		await waitFor(() => expect(document.querySelector('.grid')).not.toBeNull());
		vi.mocked(fetchActivity).mockRejectedValueOnce(new Error('offline'));
		await rerender({ layout: 'month' });
		expect(await screen.findByText(/Could not load this month/)).toBeTruthy();
		expect(document.querySelector('.month-grid')).toBeNull();
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		expect(screen.queryByText(/Could not load this month/)).toBeNull();
	});

	it('no summary line while the goal has no countable day yet (not "0 of 0 days")', async () => {
		vi.mocked(loadStudyHistory).mockResolvedValue({
			decks: [],
			cards: [],
			reviews: [],
			merged: 0,
			goals: { version: 1, showStreak: true, history: [{ from: '2026-11-16', metric: 'activity:review', target: 5 }] }
		});
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		// Today is a goal day (its stage is listed) but still open, so nothing is counted.
		await waitFor(() => expect(screen.getByRole('list', { name: 'Daily activity' }).textContent).toMatch(/of 5/));
		expect(screen.queryByText(/Goal reached on/)).toBeNull();
	});

	it('a failed page keeps the month on screen and the paging in step with it (#100 review)', async () => {
		render(ActivityHeatmap, { props: { layout: 'month' }, context: ctx.context });
		await waitFor(() => expect(monthName()?.textContent).toBe('November 2026'));
		vi.mocked(fetchActivity).mockRejectedValueOnce(new Error('offline'));
		await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
		expect(await screen.findByText(/Could not load this month/)).toBeTruthy();
		expect(monthName()?.textContent).toBe('November 2026');
		// Still November: Next stays disabled and Previous asks for October again, not September.
		expect(screen.getByRole('button', { name: 'Next month' }).hasAttribute('disabled')).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
		await waitFor(() => expect(monthName()?.textContent).toBe('October 2026'));
		expect(vi.mocked(fetchActivity).mock.calls.at(-1)).toEqual(['2026-10-01', '2026-10-31']);
		expect(screen.queryByText(/Could not load this month/)).toBeNull();
	});
});
