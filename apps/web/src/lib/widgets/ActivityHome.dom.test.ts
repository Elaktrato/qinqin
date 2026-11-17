import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('$lib/time/zone', () => ({ currentStudyDay: vi.fn(), onStudyDayChange: vi.fn() }));
vi.mock('$lib/study/studyData', () => ({ getStudyData: vi.fn() }));
vi.mock('$lib/study/history', () => ({ loadStudyHistory: vi.fn() }));
vi.mock('$lib/activity/viewPrefs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/activity/viewPrefs')>()),
	loadActivityView: vi.fn(() => Promise.resolve({ scope: 'workspace', hidden: [] })),
	saveActivityView: vi.fn(() => Promise.resolve())
}));
vi.mock('./options', async (importOriginal) => ({
	...(await importOriginal<typeof import('./options')>()),
	loadWidgetOptions: vi.fn()
}));

import { fetchActivity } from '$lib/api/stats';
import { loadStudyHistory } from '$lib/study/history';
import { getStudyData } from '$lib/study/studyData';
import { studyDay } from '$lib/time/studyDay';
import { currentStudyDay, onStudyDayChange } from '$lib/time/zone';
import { workspaces } from '$lib/workspaces';
import ActivityHome from './ActivityHome.svelte';
import { loadWidgetOptions } from './options';

const WS = { id: 3, language: 'zh', name: 'zh' } as never;

beforeEach(() => {
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(onStudyDayChange).mockReturnValue(() => {});
	vi.mocked(getStudyData).mockResolvedValue({ decks: [], cards: [] });
	vi.mocked(loadStudyHistory).mockResolvedValue({ decks: [], cards: [], reviews: [], merged: 0 });
	vi.mocked(fetchActivity).mockImplementation(async (from, to) => ({ from, to, timeZone: 'UTC', sources: [], cells: [] }));
	workspaces.set({ list: [WS], current: WS });
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('ActivityHome', () => {
	it('renders the stored layout', async () => {
		vi.mocked(loadWidgetOptions).mockResolvedValue({ row: null, heatmapLayout: 'week' });
		render(ActivityHome);
		await waitFor(() => expect(document.querySelector('.week-days')).not.toBeNull());
		expect(document.querySelector('.grid')).toBeNull();
	});

	it('renders the month calendar when chosen', async () => {
		vi.mocked(loadWidgetOptions).mockResolvedValue({ row: null, heatmapLayout: 'month' });
		render(ActivityHome);
		await waitFor(() => expect(document.querySelector('.month-grid')).not.toBeNull());
	});

	it('shows a loading card and requests nothing while the row loads (#100 review)', async () => {
		vi.mocked(loadWidgetOptions).mockReturnValue(new Promise(() => {}));
		render(ActivityHome);
		await waitFor(() => expect(screen.getByText('Loading activity…')).toBeTruthy());
		await new Promise((r) => setTimeout(r, 0));
		expect(document.querySelector('.grid')).toBeNull();
		expect(fetchActivity).not.toHaveBeenCalled();
	});

	it('a month user gets one request, for the month, and never sees another window', async () => {
		let resolveOptions: (o: { row: null; heatmapLayout: 'month' }) => void = () => {};
		vi.mocked(loadWidgetOptions).mockReturnValue(new Promise((r) => (resolveOptions = r)));
		render(ActivityHome);
		await new Promise((r) => setTimeout(r, 0));
		resolveOptions({ row: null, heatmapLayout: 'month' });
		await waitFor(() => expect(document.querySelector('.month-grid')).not.toBeNull());
		expect(fetchActivity).toHaveBeenCalledTimes(1);
		const today = studyDay([]).today();
		expect(vi.mocked(fetchActivity).mock.calls[0]).toEqual([`${today.slice(0, 7)}-01`, today]);
		expect(document.querySelector('.grid')).toBeNull();
	});

	it('shows the garden when the row fails to load', async () => {
		vi.mocked(loadWidgetOptions).mockRejectedValue(new Error('offline'));
		render(ActivityHome);
		await waitFor(() => expect(document.querySelector('.grid')).not.toBeNull());
		await new Promise((r) => setTimeout(r, 0));
		expect(document.querySelector('.grid')).not.toBeNull();
	});
});
