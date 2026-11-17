import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/widgets/layout', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/widgets/layout')>()),
	loadLayout: vi.fn(),
	saveLayout: vi.fn(() => Promise.resolve())
}));
vi.mock('$lib/widgets/options', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/widgets/options')>()),
	loadWidgetOptions: vi.fn(),
	saveHeatmapLayout: vi.fn()
}));

import { pluginStates } from '$lib/plugins/states';
import { loadLayout } from '$lib/widgets/layout';
import { loadWidgetOptions, saveHeatmapLayout } from '$lib/widgets/options';
import HomeLayoutEditor from './HomeLayoutEditor.svelte';

beforeEach(() => {
	pluginStates.set({ list: [], status: 'ready' });
	vi.mocked(loadLayout).mockResolvedValue(null);
	vi.mocked(loadWidgetOptions).mockResolvedValue({ row: null, heatmapLayout: 'garden' });
	vi.mocked(saveHeatmapLayout).mockResolvedValue(undefined);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	pluginStates.set({ list: [], status: 'idle' });
});

const fieldset = () => screen.findByRole('group', { name: 'Heatmap layout' });

describe('Settings -> Home: the heatmap layout', () => {
	it('shows a Heatmap layout fieldset with three radios on the activity-heatmap row, garden checked by default', async () => {
		render(HomeLayoutEditor);
		const group = await fieldset();
		const radios = within(group).getAllByRole('radio') as HTMLInputElement[];
		expect(radios.map((r) => r.value)).toEqual(['garden', 'month', 'week']);
		expect(within(group).getByRole('radio', { name: 'Garden grid' })).toHaveProperty('checked', true);
		expect(within(group).getByRole('radio', { name: 'Month calendar' })).toBeTruthy();
		const week = within(group).getByRole('radio', { name: 'This week' });
		// Each option's one-line description is linked.
		const described = document.getElementById(week.getAttribute('aria-describedby') ?? '');
		expect(described?.textContent).toMatch(/seven/i);
	});

	it('checks the stored layout', async () => {
		vi.mocked(loadWidgetOptions).mockResolvedValue({ row: null, heatmapLayout: 'week' });
		render(HomeLayoutEditor);
		const group = await fieldset();
		await waitFor(() => expect(within(group).getByRole('radio', { name: 'This week' })).toHaveProperty('checked', true));
	});

	it('choosing Month saves through saveHeatmapLayout and announces it', async () => {
		render(HomeLayoutEditor);
		const group = await fieldset();
		await fireEvent.click(within(group).getByRole('radio', { name: 'Month calendar' }));
		await waitFor(() => expect(saveHeatmapLayout).toHaveBeenCalledWith('month'));
		await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Heatmap layout: Month calendar.'));
	});

	it('a failed save shows the error and keeps the previous choice checked', async () => {
		vi.mocked(saveHeatmapLayout).mockRejectedValue(new Error('offline'));
		render(HomeLayoutEditor);
		const group = await fieldset();
		await fireEvent.click(within(group).getByRole('radio', { name: 'This week' }));
		await waitFor(() => expect(within(group).getByRole('radio', { name: 'Garden grid' })).toHaveProperty('checked', true));
		expect(within(group).getByText(/Could not save the heatmap layout \(offline\)/)).toBeTruthy();
		expect(document.querySelector('[aria-live="polite"]')?.textContent).toMatch(/Could not save the heatmap layout/);
	});

	it('the fieldset is shown only while the widget is on the home page', async () => {
		vi.mocked(loadLayout).mockResolvedValue(['daily-goal']);
		render(HomeLayoutEditor);
		await screen.findByRole('heading', { name: 'On the home page' });
		expect(screen.queryByRole('group', { name: 'Heatmap layout' })).toBeNull();
	});
});
