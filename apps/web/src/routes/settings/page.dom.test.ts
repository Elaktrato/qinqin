import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
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
import { primaryActions } from '$lib/ui/testing/primary';
import { workspaces, workspacesLoadError, workspacesLoaded } from '$lib/workspaces';
import Page from './+page.svelte';

const plugin = { id: 'qinqin-journal', manifest: { name: 'Journal', version: '1.2.3' }, enabled: true, order: 2 };

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

describe('the settings tab row in the lighter look (#106)', () => {
	afterEach(() => auth.set({ token: null, user: null }));

	it('is a tablist with eight tabs for a member and ten for an admin', async () => {
		render(Page);
		const list = screen.getByRole('tablist', { name: 'Settings' });
		expect([...list.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).toEqual([
			'Workspaces',
			'Home',
			'Appearance',
			'Study',
			'Features',
			'Plugins',
			'AI',
			'Account'
		]);
		cleanup();
		auth.set({ token: 't', user: { id: 1, username: 'root', admin: true } as never });
		render(Page);
		expect(screen.getAllByRole('tab')).toHaveLength(10);
	});

	it('the ?tab=data deep link selects Data', async () => {
		auth.set({ token: 't', user: { id: 1, username: 'root', admin: true } as never });
		setUrl('/settings?tab=data');
		render(Page);
		expect(screen.getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
	});

	it('arrow keys move focus and selection (automatic activation, as today)', async () => {
		render(Page);
		const workspaces = screen.getByRole('tab', { name: 'Workspaces' });
		workspaces.focus();
		await fireEvent.keyDown(workspaces, { key: 'ArrowRight' });
		const home = screen.getByRole('tab', { name: 'Home' });
		expect(home.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(home);
	});

	it('scrolls the selected tab into view when a deep link opens a far one', async () => {
		const scrollIntoView = vi.fn();
		const original = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = scrollIntoView;
		try {
			setUrl('/settings?tab=account');
			render(Page);
			await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
		} finally {
			Element.prototype.scrollIntoView = original;
		}
	});
});

describe('the workspaces view in the lighter look (#106)', () => {
	it('has one primary action and hairline rows with secondary actions', async () => {
		workspaces.set({
			list: [{ id: 1, language: 'zh', name: 'Chinese', settings: {}, updatedAt: '' } as never],
			current: null
		});
		workspacesLoaded.set(true);
		render(Page);
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Create workspace' }).className).toContain('primary');
		expect(screen.getByRole('button', { name: /^Rename / }).className).toContain('secondary');
		expect(screen.getByRole('button', { name: 'Create workspace' }).closest('form')?.querySelector('.field')).toBeTruthy();
	});
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

describe('the new-workspace target (#99)', () => {
	it('the drawer\'s + lands on the New workspace heading (#new-workspace, focusable by script)', async () => {
		render(Page);
		const heading = document.getElementById('new-workspace');
		expect(heading?.tagName).toBe('H3');
		expect(heading?.textContent).toBe('New workspace');
		expect(heading?.getAttribute('tabindex')).toBe('-1');
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

describe('the plugin list in the lighter look (#106)', () => {
	it('shows the version as a chip and saves with a secondary Button; no primary', async () => {
		setUrl('/settings?tab=plugins');
		render(Page);
		const row = (await screen.findByText('Journal')).closest('li')!;
		expect(within(row).getByText('1.2.3')).toBeTruthy();
		const save = within(row).getByRole('button', { name: 'Save' });
		expect(save.className).toContain('secondary');
		expect(primaryActions(document.body)).toHaveLength(0);
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
