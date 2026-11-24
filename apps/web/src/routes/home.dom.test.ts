import { EventLog } from '$lib/events';
import type { MockInstance } from 'vitest';
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/widgets/layout', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/widgets/layout')>()),
	loadLayout: vi.fn(async () => null)
}));
vi.mock('$lib/widgets/registry', () => ({ allWidgets: vi.fn(() => []) }));
vi.mock('$lib/api/account', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/account')>()),
	getAuthOptions: vi.fn(() => Promise.reject(new Error('offline')))
}));
vi.mock('$lib/milestones/loadMilestones', () => ({ loadMilestones: vi.fn(), markSeen: vi.fn() }));
vi.mock('$lib/time/zone', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/time/zone')>();
	return { ...actual, currentStudyDay: vi.fn(actual.currentStudyDay) };
});
vi.mock('$lib/study/data', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/data')>()),
	onStudyChange: vi.fn(() => () => {})
}));

import { goto } from '$app/navigation';
import { allWidgets } from '$lib/widgets/registry';
import { loadMilestones, markSeen, type MilestonesView } from '$lib/milestones/loadMilestones';
import { studyDay } from '$lib/time/studyDay';
import { currentStudyDay } from '$lib/time/zone';
import { onStudyChange } from '$lib/study/data';
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

function milestones(title = '100 reviews'): MilestonesView {
	const r = { id: 'reviews:100', at: Date.parse('2026-11-17T09:00:00Z'), day: '2026-11-17' };
	return {
		plan: { kind: 'recent', items: [r], ids: ['reviews:100'] },
		history: [],
		titles: new Map([['reviews:100', title]]),
		reached: [r],
		live: new Map(),
		workspaceId: 1
	};
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => (resolve = res));
	return { promise, resolve };
}

function select(id: number | null, language = 'zh'): void {
	ctx.session.workspaces.set({ list: [], current: id === null ? null : ({ id, language, name: `w${id}` } as never) });
}

beforeEach(() => {
	select(1);
	ctx.session.plugins.set({ list: [], status: 'ready' });
	vi.mocked(loadMilestones).mockResolvedValue(milestones());
	vi.mocked(markSeen).mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
	ctx.session.plugins.set({ list: [], status: 'idle' });
});

const cardHeading = () => screen.queryByRole('heading', { level: 2, name: 'Milestone reached' });

describe('home milestones', () => {
	it('shows the card for the log families above the widgets', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		expect(loadMilestones).toHaveBeenCalledWith(expect.anything(), 1, { scope: 'home', language: 'zh', states: expect.anything() });
		expect(screen.getByText(/^100 reviews, reached/)).toBeTruthy();
	});

	it('the status region is there before the card loads, and the card sits outside it', async () => {
		const later = deferred<MilestonesView>();
		vi.mocked(loadMilestones).mockReturnValueOnce(later.promise);
		render(Page, { context: ctx.context });
		const status = document.querySelector('.milestone-status[role="status"]')!;
		expect(status).not.toBeNull();
		later.resolve(milestones());
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		expect(document.querySelector('.milestone-status[role="status"]')).toBe(status);
		expect(status.textContent).toBe('Milestone reached: 100 reviews');
		expect(status.contains(cardHeading())).toBe(false);
	});

	it('Dismiss hides it and marks the covered ids', async () => {
		const ms = milestones();
		vi.mocked(loadMilestones).mockResolvedValue(ms);
		render(Page, { context: ctx.context });
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(markSeen).toHaveBeenCalledWith(expect.anything(), ms);
		expect(cardHeading()).toBeNull();
		expect(document.activeElement?.tagName).toBe('H1');
	});

	it('nothing before the plugin states are ready, and nothing without a workspace', async () => {
		ctx.session.plugins.set({ list: [], status: 'loading' });
		render(Page, { context: ctx.context });
		await tick();
		expect(loadMilestones).not.toHaveBeenCalled();
		ctx.session.plugins.set({ list: [], status: 'ready' });
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		select(null);
		await waitFor(() => expect(cardHeading()).toBeNull());
	});

	it('a workspace switch removes the old card at once: its ids are never written into the new workspace', async () => {
		render(Page, { context: ctx.context });
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		const next = deferred<MilestonesView>();
		vi.mocked(loadMilestones).mockReturnValueOnce(next.promise);
		select(2);
		await tick();
		expect(cardHeading()).toBeNull();
		expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
		expect(markSeen).not.toHaveBeenCalled();
	});

	it('a workspace switch reloads and drops the stale answer', async () => {
		const first = deferred<MilestonesView>();
		vi.mocked(loadMilestones).mockReturnValueOnce(first.promise).mockResolvedValueOnce(milestones('from workspace 2'));
		render(Page, { context: ctx.context });
		await tick();
		select(2);
		await waitFor(() => expect(screen.getByText(/^from workspace 2, reached/)).toBeTruthy());
		expect(loadMilestones).toHaveBeenLastCalledWith(expect.anything(), 2, { scope: 'home', language: 'zh', states: expect.anything() });
		first.resolve(milestones('from workspace 1'));
		await tick();
		await Promise.resolve();
		expect(screen.queryByText(/from workspace 1/)).toBeNull();
	});

	it('a study write or a posted event of the workspace loads again; another workspace does not', async () => {
		vi.mocked(loadMilestones).mockResolvedValue({ ...milestones(), plan: { kind: 'none' } });
		render(Page, { context: ctx.context });
		await waitFor(() => expect(loadMilestones).toHaveBeenCalledTimes(1));
		const onWrite = vi.mocked(onStudyChange).mock.calls.at(-1)![1];
		const onLog = vi.mocked(onEventLogChange).mock.calls.at(-1)![0];
		onWrite(2);
		await tick();
		expect(loadMilestones).toHaveBeenCalledTimes(1);
		vi.mocked(loadMilestones).mockResolvedValue(milestones());
		onWrite(1);
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		onLog(1);
		await waitFor(() => expect(loadMilestones).toHaveBeenCalledTimes(3));
	});
});

describe('home heading and search', () => {
	afterEach(() => vi.useRealTimers());

	it.each([
		[9, 'Good morning'],
		[15, 'Good afternoon'],
		[21, 'Good evening']
	])('the h1 is the greeting for the device hour (%i:00)', async (hour, greeting) => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 10, 16, hour, 0, 0));
		render(Page, { context: ctx.context });
		const headings = screen.getAllByRole('heading', { level: 1 });
		expect(headings).toHaveLength(1);
		expect(headings[0].textContent).toBe(greeting);
	});

	it("a date line shows the learner's today, not the device's", async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-16T20:00:00Z')); // already the 17th in Tokyo
		vi.mocked(currentStudyDay).mockReturnValue(studyDay([{ zone: 'Asia/Tokyo', from: null }]));
		render(Page, { context: ctx.context });
		expect(document.querySelector('.date')?.textContent).toBe('Tuesday 17 November');
	});

	it('the search is a labelled field that goes to /search?q=', async () => {
		render(Page, { context: ctx.context });
		const field = screen.getByRole('searchbox', { name: 'Search entries' });
		await fireEvent.input(field, { target: { value: ' 你好 ' } });
		await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
		await waitFor(() => expect(goto).toHaveBeenCalledWith(`/search?q=${encodeURIComponent('你好')}`));
	});
});

describe('home with a feature switched off', () => {
	it('shows no widget of a switched-off feature', async () => {
		const actual = await vi.importActual<typeof import('$lib/widgets/registry')>('$lib/widgets/registry');
		vi.mocked(allWidgets).mockImplementation((plugins, states, language) =>
			actual.allWidgets(plugins, states, language, [])
		);
		ctx.session.plugins.set({ list: [{ id: 'qinqin-flashcards', manifest: {}, enabled: true, order: 0 }], status: 'ready' });
		const { unmount } = render(Page, { context: ctx.context });
		await waitFor(() => expect(document.querySelector('[data-widget="flashcards-summary"]')).not.toBeNull());
		unmount();
		ctx.session.plugins.set({ list: [{ id: 'qinqin-flashcards', manifest: {}, enabled: false, order: 0 }], status: 'ready' });
		render(Page, { context: ctx.context });
		await waitFor(() => expect(screen.getByText(/None of your home widgets is available in this workspace/)).toBeTruthy());
		expect(document.querySelector('[data-widget="flashcards-summary"]')).toBeNull();
		const link = screen.getByRole('link', { name: 'Choose widgets in Settings' });
		expect(link.getAttribute('href')).toBe('/settings?tab=layout');
	});
});
