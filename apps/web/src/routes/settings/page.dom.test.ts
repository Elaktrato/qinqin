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
import { auth } from '$lib/auth';
import { workspaces, workspacesLoadError, workspacesLoaded } from '$lib/workspaces';
import Page from './+page.svelte';

const plugin = { id: 'qinqin-journal', manifest: { name: 'Journal' }, enabled: true, order: 2 };

beforeEach(() => {
	setUrl('/settings');
	workspaces.set({ list: [], current: null });
	workspacesLoaded.set(false);
	workspacesLoadError.set('');
	vi.mocked(api).mockImplementation((async (url: string) => {
		if (url === '/api/plugins') return [plugin];
		if (url.startsWith('/api/ai/providers')) return { providers: [], canManageCustom: false, privateAllowed: false };
		if (url.startsWith('/api/ai')) return { key: null, keys: [], active: null, fake: false, models: [], available: false, reason: '', usage: { callsLastHour: 0, limitPerHour: 10, inputTokens: 0, outputTokens: 0 } };
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

describe('settings after a failed shell load', () => {
	it('shows the error with Try again instead of loading forever, and recovers', async () => {
		workspacesLoadError.set('Could not load workspaces.');
		render(Page);
		expect(screen.queryByText('Loading workspaces…')).toBeNull();
		expect(screen.getByText('Could not load workspaces.')).toBeTruthy();
		vi.mocked(api).mockImplementation((async (url: string) =>
			url === '/api/workspaces' ? [{ id: 1, language: 'zh', name: '', settings: {}, updatedAt: '' }] : url === '/api/plugins' ? [] : []) as never);
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(screen.queryByText('Could not load workspaces.')).toBeNull());
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

describe('hidden plugins', () => {
	it('leaves out plugins the server flags hidden, whatever their id', async () => {
		setUrl('/settings?tab=plugins');
		const base = vi.mocked(api).getMockImplementation()!;
		vi.mocked(api).mockImplementation((async (url: string, ...rest: unknown[]) => {
			if (url === '/api/plugins') {
				return [
					plugin,
					{ id: 'internal-thing', manifest: { name: 'Internal thing' }, enabled: true, order: 0, hidden: true }
				];
			}
			return (base as (...a: unknown[]) => unknown)(url, ...rest);
		}) as never);
		render(Page);
		await screen.findByText('Journal');
		expect(screen.queryByText('Internal thing')).toBeNull();
	});
});

describe('settings page titles', () => {
	afterEach(() => {
		auth.set({ token: null, user: null });
		document.title = '';
	});

	it('names the Admin section in the document title', async () => {
		auth.set({ token: 't', user: { id: 1, username: 'root', admin: true } as never });
		setUrl('/settings?tab=admin&section=email');
		render(Page);
		await waitFor(() => expect(document.title).toBe('Email · Admin · Settings · qinqin'));
	});
});
