import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayKey } from '$lib/activity/activity';

vi.mock('$lib/api/stats', () => ({ fetchActivity: vi.fn() }));
vi.mock('$lib/activity/viewPrefs', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/activity/viewPrefs')>()),
	loadActivityView: vi.fn(() => Promise.resolve({ scope: 'workspace', hidden: [] })),
	saveActivityView: vi.fn(() => Promise.resolve())
}));

import { fetchActivity } from '$lib/api/stats';
import { workspaces } from '$lib/workspaces';
import ActivityHeatmap from './ActivityHeatmap.svelte';

afterEach(cleanup);

describe('ActivityHeatmap accessibility', () => {
	it('exposes each active day to assistive tech as a list item', async () => {
		const today = dayKey(new Date());
		workspaces.set({ list: [], current: { id: 3, language: 'zh', name: 'zh' } as never });
		vi.mocked(fetchActivity).mockResolvedValue({
			from: today,
			to: today,
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
