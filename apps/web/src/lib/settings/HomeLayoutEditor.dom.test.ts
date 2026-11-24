import { testContext, type TestContext } from '$lib/testing/context';
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
import { primaryActions } from '$lib/ui/testing/primary';
import HomeLayoutEditor from './HomeLayoutEditor.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

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
		render(HomeLayoutEditor, { context: ctx.context });
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
		render(HomeLayoutEditor, { context: ctx.context });
		const group = await fieldset();
		await waitFor(() => expect(within(group).getByRole('radio', { name: 'This week' })).toHaveProperty('checked', true));
	});

	it('choosing Month saves through saveHeatmapLayout and announces it', async () => {
		render(HomeLayoutEditor, { context: ctx.context });
		const group = await fieldset();
		await fireEvent.click(within(group).getByRole('radio', { name: 'Month calendar' }));
		await waitFor(() => expect(saveHeatmapLayout).toHaveBeenCalledWith('month'));
		await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Heatmap layout: Month calendar.'));
	});

	it('a failed save shows the error and keeps the previous choice checked', async () => {
		vi.mocked(saveHeatmapLayout).mockRejectedValue(new Error('offline'));
		render(HomeLayoutEditor, { context: ctx.context });
		const group = await fieldset();
		await fireEvent.click(within(group).getByRole('radio', { name: 'This week' }));
		await waitFor(() => expect(within(group).getByRole('radio', { name: 'Garden grid' })).toHaveProperty('checked', true));
		expect(within(group).getByText(/Could\ not\ save\ the\ heatmap\ layout\ \(The\ server\ did\ not\ answer\.\)\./)).toBeTruthy();
		expect(document.querySelector('[aria-live="polite"]')?.textContent).toMatch(/Could not save the heatmap layout/);
	});

	it('saves one at a time, newest wins; a failed earlier save never resets the radio (#100 review)', async () => {
		let failMonth: (err: Error) => void = () => {};
		vi.mocked(saveHeatmapLayout)
			.mockImplementationOnce(() => new Promise((_, reject) => (failMonth = reject)))
			.mockResolvedValue(undefined);
		render(HomeLayoutEditor, { context: ctx.context });
		const group = await fieldset();
		await fireEvent.click(within(group).getByRole('radio', { name: 'Month calendar' }));
		await fireEvent.click(within(group).getByRole('radio', { name: 'This week' }));
		await fireEvent.click(within(group).getByRole('radio', { name: 'Garden grid' }));
		await fireEvent.click(within(group).getByRole('radio', { name: 'This week' }));
		// Only the first is in flight; the rest wait and collapse into the newest.
		expect(saveHeatmapLayout).toHaveBeenCalledTimes(1);
		failMonth(new Error('offline'));
		await waitFor(() => expect(saveHeatmapLayout).toHaveBeenCalledTimes(2));
		expect(vi.mocked(saveHeatmapLayout).mock.calls[1]).toEqual(['week']);
		await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Heatmap layout: This week.'));
		expect(within(group).getByRole('radio', { name: 'This week' })).toHaveProperty('checked', true);
		expect(within(group).queryByText(/Could not save the heatmap layout/)).toBeNull();
	});

	it('when the newest save fails the radio goes back to the last saved layout', async () => {
		vi.mocked(saveHeatmapLayout).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('offline'));
		render(HomeLayoutEditor, { context: ctx.context });
		const group = await fieldset();
		await fireEvent.click(within(group).getByRole('radio', { name: 'Month calendar' }));
		await waitFor(() => expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Heatmap layout: Month calendar.'));
		await fireEvent.click(within(group).getByRole('radio', { name: 'This week' }));
		await waitFor(() => expect(within(group).getByRole('radio', { name: 'Month calendar' })).toHaveProperty('checked', true));
		expect(within(group).getByText(/Could\ not\ save\ the\ heatmap\ layout\ \(The\ server\ did\ not\ answer\.\)\./)).toBeTruthy();
	});

	it('is hairline rows with base Buttons and no primary action (it saves on change, #106)', async () => {
		render(HomeLayoutEditor, { context: ctx.context });
		await fieldset();
		expect(document.querySelectorAll('.items .item').length).toBeGreaterThan(0);
		// A change saves itself: the view has no primary action.
		expect(primaryActions(document.body)).toHaveLength(0);
		const up = screen.getAllByRole('button', { name: /^Move .* up$/ })[0];
		expect(up.className).toContain('button');
		expect(up.className).toContain('plain');
		const reset = screen.getByRole('button', { name: 'Reset to default' });
		expect(reset.className).toContain('secondary');
	});

	it('the fieldset is shown only while the widget is on the home page', async () => {
		vi.mocked(loadLayout).mockResolvedValue(['daily-goal']);
		render(HomeLayoutEditor, { context: ctx.context });
		await screen.findByRole('heading', { name: 'On the home page' });
		expect(screen.queryByRole('group', { name: 'Heatmap layout' })).toBeNull();
	});
});

describe('Settings -> Home with a feature switched off', () => {
	it("lists the flashcards widgets while Flashcards is on and leaves them out when it is off", async () => {
		pluginStates.set({ list: [{ id: 'qinqin-flashcards', manifest: {}, enabled: true, order: 0 }], status: 'ready' });
		const { unmount } = render(HomeLayoutEditor, { context: ctx.context });
		await fieldset();
		expect(screen.getAllByText('Flashcards', { selector: '.items strong' })).toHaveLength(1);
		unmount();
		pluginStates.set({ list: [{ id: 'qinqin-flashcards', manifest: {}, enabled: false, order: 0 }], status: 'ready' });
		render(HomeLayoutEditor, { context: ctx.context });
		await fieldset();
		// No row; the parked note says it stays in the layout for when the feature is back.
		expect(screen.queryAllByText('Flashcards', { selector: '.items strong' })).toHaveLength(0);
		expect(screen.queryByText('Words', { selector: '.items strong' })).toBeNull();
	});
});
