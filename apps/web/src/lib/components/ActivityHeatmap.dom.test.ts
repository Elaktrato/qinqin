import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('$lib/time/zone', () => ({
	currentStudyDay: vi.fn(),
	onStudyDayChange: vi.fn()
}));
vi.mock('$lib/activity/viewPrefs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/activity/viewPrefs')>()),
	loadActivityView: vi.fn(() => Promise.resolve({ scope: 'workspace', hidden: [] })),
	saveActivityView: vi.fn(() => Promise.resolve())
}));

import { fetchActivity } from '$lib/api/stats';
import { studyDay } from '$lib/time/studyDay';
import { currentStudyDay, onStudyDayChange } from '$lib/time/zone';
import { workspaces } from '$lib/workspaces';
import ActivityHeatmap from './ActivityHeatmap.svelte';

const TOKYO = studyDay([{ zone: 'Asia/Tokyo', from: null }]);
const BERLIN = studyDay([{ zone: 'Europe/Berlin', from: null }]);
const empty = { from: '', to: '', timeZone: 'UTC', sources: [], cells: [] };

beforeEach(() => {
	vi.mocked(currentStudyDay).mockReturnValue(studyDay([]));
	vi.mocked(onStudyDayChange).mockReturnValue(() => {});
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('ActivityHeatmap accessibility', () => {
	it('exposes each active day to assistive tech as a list item', async () => {
		const today = studyDay([]).today();
		workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'zh' } as never });
		vi.mocked(fetchActivity).mockResolvedValue({
			from: today,
			to: today,
			timeZone: 'UTC',
			sources: [
				{
					type: 'review',
					plugin: 'flashcards',
					label: 'Reviews',
					unit: 'count',
					describe: { one: 'flashcard review', other: 'flashcard reviews' }
				}
			],
			cells: [{ day: today, workspace: 3, type: 'review', points: 5, raw: 5 }]
		});
		render(ActivityHeatmap);
		const list = await screen.findByRole('list', { name: 'Daily activity' });
		await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));
		expect(within(list).getByRole('listitem').textContent).toContain(`${today}: 5 points`);
		// The coloured cells are decorative for assistive tech now.
		expect(document.querySelector('.grid')?.getAttribute('aria-hidden')).toBe('true');
	});
});

describe('ActivityHeatmap learner days', () => {
	it("requests the 91 learner days ending today in the user's zone", async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-15T15:30:00Z')); // the 16th in Tokyo
		vi.mocked(currentStudyDay).mockReturnValue(TOKYO);
		vi.mocked(fetchActivity).mockResolvedValue(empty);
		workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'zh' } as never });
		render(ActivityHeatmap);
		await waitFor(() => expect(fetchActivity).toHaveBeenCalled());
		expect(vi.mocked(fetchActivity).mock.calls[0]).toEqual(['2026-08-18', '2026-11-16']);
	});

	it('re-requests the window when the zone changes', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-11-15T15:30:00Z'));
		let listener: ((d: typeof TOKYO) => void) | undefined;
		vi.mocked(onStudyDayChange).mockImplementation((l) => {
			listener = l;
			return () => {};
		});
		vi.mocked(currentStudyDay).mockReturnValue(BERLIN);
		vi.mocked(fetchActivity).mockResolvedValue(empty);
		workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'zh' } as never });
		render(ActivityHeatmap);
		await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(1));
		expect(vi.mocked(fetchActivity).mock.calls[0][1]).toBe('2026-11-15');
		listener!(TOKYO);
		await waitFor(() => expect(fetchActivity).toHaveBeenCalledTimes(2));
		expect(vi.mocked(fetchActivity).mock.calls[1]).toEqual(['2026-08-18', '2026-11-16']);
	});
});
