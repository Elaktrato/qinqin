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
vi.mock('$lib/events', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/events')>()),
	onEventLogChange: vi.fn(() => () => {})
}));
vi.mock('$lib/study/store', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/study/store')>()),
	onStudyWrite: vi.fn(() => () => {})
}));

import { loadMilestones, markSeen, type MilestonesView } from '$lib/milestones/loadMilestones';
import { onEventLogChange } from '$lib/events';
import { pluginStates } from '$lib/plugins/states';
import { onStudyWrite } from '$lib/study/store';
import { workspaces } from '$lib/workspaces';
import Page from './+page.svelte';

function milestones(title = '100 reviews'): MilestonesView {
	const r = { id: 'reviews:100', at: Date.parse('2026-11-17T09:00:00Z'), day: '2026-11-17' };
	return {
		plan: { kind: 'recent', items: [r], ids: ['reviews:100'] },
		history: [],
		titles: new Map([['reviews:100', title]]),
		reached: [r],
		live: new Map()
	};
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((res) => (resolve = res));
	return { promise, resolve };
}

function select(id: number | null, language = 'zh'): void {
	workspaces.set({ list: [], current: id === null ? null : ({ id, language, name: `w${id}` } as never) });
}

beforeEach(() => {
	select(1);
	pluginStates.set({ list: [], status: 'ready' });
	vi.mocked(loadMilestones).mockResolvedValue(milestones());
	vi.mocked(markSeen).mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	select(null);
	pluginStates.set({ list: [], status: 'idle' });
});

const cardHeading = () => screen.queryByRole('heading', { level: 2, name: 'Milestone reached' });

describe('home milestones', () => {
	it('shows the card for the log families above the widgets', async () => {
		render(Page);
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		expect(loadMilestones).toHaveBeenCalledWith(1, { scope: 'home', language: 'zh' });
		expect(screen.getByText(/^100 reviews, reached/)).toBeTruthy();
	});

	it('Dismiss hides it and marks the covered ids', async () => {
		const ms = milestones();
		vi.mocked(loadMilestones).mockResolvedValue(ms);
		render(Page);
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(markSeen).toHaveBeenCalledWith(1, ms);
		expect(cardHeading()).toBeNull();
		expect(document.activeElement?.tagName).toBe('H1');
	});

	it('nothing before the plugin states are ready, and nothing without a workspace', async () => {
		pluginStates.set({ list: [], status: 'loading' });
		render(Page);
		await tick();
		expect(loadMilestones).not.toHaveBeenCalled();
		pluginStates.set({ list: [], status: 'ready' });
		await waitFor(() => expect(cardHeading()).toBeTruthy());
		select(null);
		await waitFor(() => expect(cardHeading()).toBeNull());
	});

	it('a workspace switch reloads and drops the stale answer', async () => {
		const first = deferred<MilestonesView>();
		vi.mocked(loadMilestones).mockReturnValueOnce(first.promise).mockResolvedValueOnce(milestones('from workspace 2'));
		render(Page);
		await tick();
		select(2);
		await waitFor(() => expect(screen.getByText(/^from workspace 2, reached/)).toBeTruthy());
		expect(loadMilestones).toHaveBeenLastCalledWith(2, { scope: 'home', language: 'zh' });
		first.resolve(milestones('from workspace 1'));
		await tick();
		await Promise.resolve();
		expect(screen.queryByText(/from workspace 1/)).toBeNull();
	});

	it('a study write or a posted event of the workspace loads again; another workspace does not', async () => {
		vi.mocked(loadMilestones).mockResolvedValue({ ...milestones(), plan: { kind: 'none' } });
		render(Page);
		await waitFor(() => expect(loadMilestones).toHaveBeenCalledTimes(1));
		const onWrite = vi.mocked(onStudyWrite).mock.calls.at(-1)![0];
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
