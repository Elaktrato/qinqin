import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { api } from '$lib/api/client';
import { setUrl } from '$lib/testing/appState.svelte';
import { workspaces, workspacesLoaded } from '$lib/workspaces';
import Page from './+page.svelte';

const plugin = { id: 'qinqin-reader', manifest: { name: 'Reader' }, enabled: true, order: 2 };

beforeEach(() => {
	setUrl('/settings');
	workspaces.set({ list: [], current: null });
	workspacesLoaded.set(false);
	vi.mocked(api).mockImplementation((async (url: string) => {
		if (url === '/api/plugins') return [plugin];
		if (url.startsWith('/api/ai')) return { key: null, models: [], available: false, reason: '', usage: { callsLastHour: 0, limitPerHour: 10, inputTokens: 0, outputTokens: 0 } };
		return [];
	}) as never);
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe('settings loading states', () => {
	it('shows a loading note, not "No workspaces yet.", until the list has arrived', async () => {
		render(Page);
		expect(screen.getByText('Loading workspaces…')).toBeTruthy();
		expect(screen.queryByText('No workspaces yet.')).toBeNull();
		workspacesLoaded.set(true);
		await waitFor(() => expect(screen.getByText('No workspaces yet.')).toBeTruthy());
		expect(screen.queryByText('Loading workspaces…')).toBeNull();
	});
});

describe('plugin order validation', () => {
	it('disables Save and explains when the order is cleared', async () => {
		setUrl('/settings?tab=plugins');
		render(Page);
		const order = (await screen.findByLabelText('Order')) as HTMLInputElement;
		const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		await fireEvent.input(order, { target: { value: '' } });
		await waitFor(() => expect(save.disabled).toBe(true));
		expect(screen.getByText('Enter a whole number of 0 or more.')).toBeTruthy();
		await fireEvent.input(order, { target: { value: '0' } });
		await waitFor(() => expect(save.disabled).toBe(false));
		expect(screen.queryByText('Enter a whole number of 0 or more.')).toBeNull();
	});
});
