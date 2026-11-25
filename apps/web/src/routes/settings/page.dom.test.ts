import { testContext, type TestContext, workspacesState } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));
vi.mock('$app/navigation', () => ({ goto: vi.fn(() => Promise.resolve()) }));
vi.mock('$lib/api/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/api/client')>()),
	api: vi.fn()
}));

import { goto } from '$app/navigation';
import { api } from '$lib/api/client';
import { setUrl } from '$lib/testing/appState.svelte';
import { primaryActions } from '$lib/ui/testing/primary';
import Page from './+page.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const journal = { id: 'journal', enabled: true, updatedAt: null };

beforeEach(() => {
	setUrl('/settings');
	ctx.session.workspaces.set({ list: [], current: null });
	ctx.session.workspaces.set(workspacesState(ctx.session.workspaces), false);
	ctx.session.workspaces.loadError = '';
	vi.mocked(api).mockImplementation((async (url: string) => {
		if (url === '/api/features') return [journal];
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
	afterEach(() => ctx.app.auth.set({ token: null, user: null }));

	it('is a tablist with eight tabs for a member and ten for an admin', async () => {
		render(Page, { context: ctx.context });
		const list = screen.getByRole('tablist', { name: 'Settings' });
		expect([...list.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).toEqual([
			'Workspaces',
			'Layout',
			'Appearance',
			'Study',
			'Features',
			'Notifications',
			'AI',
			'Account'
		]);
		cleanup();
		ctx.app.auth.set({ token: 't', user: { id: 1, username: 'root', admin: true } as never });
		render(Page, { context: ctx.context });
		expect(screen.getAllByRole('tab')).toHaveLength(10);
	});

	it('the ?tab=data deep link selects Data', async () => {
		ctx.app.auth.set({ token: 't', user: { id: 1, username: 'root', admin: true } as never });
		setUrl('/settings?tab=data');
		render(Page, { context: ctx.context });
		expect(screen.getByRole('tab', { name: 'Data' }).getAttribute('aria-selected')).toBe('true');
	});

	it('the old Home tab link lands on Layout, and the URL follows (the fragment kept)', async () => {
		setUrl('/settings?tab=home#bottom-bar');
		render(Page, { context: ctx.context });
		expect(screen.getByRole('tab', { name: 'Layout' }).getAttribute('aria-selected')).toBe('true');
		await waitFor(() =>
			expect(goto).toHaveBeenCalledWith('/settings?tab=layout#bottom-bar', { replaceState: true, keepFocus: true, noScroll: true })
		);
	});

	it('arrow keys move focus and selection (automatic activation, as today)', async () => {
		render(Page, { context: ctx.context });
		const workspaces = screen.getByRole('tab', { name: 'Workspaces' });
		workspaces.focus();
		await fireEvent.keyDown(workspaces, { key: 'ArrowRight' });
		const layout = screen.getByRole('tab', { name: 'Layout' });
		expect(layout.getAttribute('aria-selected')).toBe('true');
		expect(document.activeElement).toBe(layout);
	});

	it('the wrapped row shows a deep-linked far tab without a sideways scroll', async () => {
		const scrollIntoView = vi.fn();
		const original = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = scrollIntoView;
		try {
			setUrl('/settings?tab=account');
			render(Page, { context: ctx.context });
			expect(screen.getByRole('tab', { name: 'Account' }).getAttribute('aria-selected')).toBe('true');
			expect(scrollIntoView).not.toHaveBeenCalled();
		} finally {
			Element.prototype.scrollIntoView = original;
		}
	});
});

describe('the workspaces view in the lighter look (#106)', () => {
	it('has one primary action and hairline rows with secondary actions', async () => {
		ctx.session.workspaces.set({
			list: [{ id: 1, language: 'zh', name: 'Chinese', settings: {}, updatedAt: '' } as never],
			current: null
		});
		ctx.session.workspaces.set(workspacesState(ctx.session.workspaces), true);
		render(Page, { context: ctx.context });
		expect(primaryActions(document.body)).toHaveLength(1);
		expect(screen.getByRole('button', { name: 'Create workspace' }).className).toContain('primary');
		expect(screen.getByRole('button', { name: /^Rename / }).className).toContain('secondary');
		expect(screen.getByRole('button', { name: 'Create workspace' }).closest('form')?.querySelector('.field')).toBeTruthy();
	});
});

describe('settings loading states', () => {
	it('shows a loading note, not "No workspaces yet.", until the list has arrived', async () => {
		render(Page, { context: ctx.context });
		expect(screen.getByText('Loading workspaces…')).toBeTruthy();
		expect(screen.queryByText('No workspaces yet.')).toBeNull();
		ctx.session.workspaces.set(workspacesState(ctx.session.workspaces), true);
		await waitFor(() => expect(screen.getByText('No workspaces yet.')).toBeTruthy());
		expect(screen.queryByText('Loading workspaces…')).toBeNull();
	});
});

describe('the new-workspace target (#99)', () => {
	it('the drawer\'s + lands on the New workspace heading (#new-workspace, focusable by script)', async () => {
		render(Page, { context: ctx.context });
		const heading = document.getElementById('new-workspace');
		expect(heading?.tagName).toBe('H3');
		expect(heading?.textContent).toBe('New workspace');
		expect(heading?.getAttribute('tabindex')).toBe('-1');
	});
});

describe('settings after a failed shell load', () => {
	it('shows the error with Try again instead of loading forever, and recovers', async () => {
		ctx.session.workspaces.loadError = 'Could not load workspaces.';
		render(Page, { context: ctx.context });
		expect(screen.queryByText('Loading workspaces…')).toBeNull();
		expect(screen.getByText('Could not load workspaces.')).toBeTruthy();
		vi.mocked(api).mockImplementation((async (url: string) =>
			url === '/api/workspaces' ? [{ id: 1, language: 'zh', name: '', settings: {}, updatedAt: '' }] : url === '/api/features' ? [] : []) as never);
		await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(screen.queryByText('Could not load workspaces.')).toBeNull());
	});
});

describe('settings page titles', () => {
	afterEach(() => {
		ctx.app.auth.set({ token: null, user: null });
		document.title = '';
	});

	it('names the Admin section in the document title', async () => {
		ctx.app.auth.set({ token: 't', user: { id: 1, username: 'root', admin: true } as never });
		setUrl('/settings?tab=admin&section=email');
		render(Page, { context: ctx.context });
		await waitFor(() => expect(document.title).toBe('Email · Admin · Settings · qinqin'));
	});
});
