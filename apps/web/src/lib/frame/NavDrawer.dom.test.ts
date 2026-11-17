import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '$lib/auth';
import { FLASHCARDS_ID, READER_ID } from '$lib/features';
import { workspaces } from '$lib/workspaces';
import { frameSections } from './sections';
import PhoneHarness from './testing/PhoneHarness.svelte';

const sections = frameSections({
	list: [
		{ id: FLASHCARDS_ID, manifest: {}, enabled: true, order: 0 },
		{ id: READER_ID, manifest: {}, enabled: true, order: 0 }
	],
	status: 'ready'
});
const ws = (id: number, language: string, name = '') => ({ id, language, name, settings: {}, updatedAt: '' });

function signIn(admin = false) {
	auth.set({
		token: 'tok',
		user: { id: 1, username: 'mei', admin, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' }
	});
}

async function openDrawer(current: string | null = 'reader') {
	render(PhoneHarness, { sections, current });
	const opener = screen.getByRole('button', { name: 'Open menu' });
	opener.focus();
	await fireEvent.click(opener);
	const drawer = await screen.findByRole('dialog', { name: 'Menu' });
	return { opener, drawer };
}

beforeEach(() => {
	localStorage.clear();
	signIn();
	workspaces.set({ list: [ws(1, 'zh'), ws(2, 'ja'), ws(3, 'zh', 'Novels')], current: ws(3, 'zh', 'Novels') });
});
afterEach(() => {
	cleanup();
	auth.set({ token: null, user: null });
});

describe('NavDrawer', () => {
	it('a row of workspace flags, each named, the current one aria-current="true"; focus starts on it', async () => {
		const { drawer } = await openDrawer();
		const row = within(drawer).getByRole('group', { name: 'Workspaces' });
		const flags = within(row).getAllByRole('button');
		expect(flags.map((f) => f.getAttribute('aria-label'))).toEqual([
			'Workspace: Chinese',
			'Workspace: Japanese',
			'Workspace: Chinese, Novels'
		]);
		expect(flags.map((f) => f.getAttribute('aria-current'))).toEqual([null, null, 'true']);
		await waitFor(() => expect(document.activeElement).toBe(flags[2]));
	});

	it('tapping a flag selects the workspace and closes the drawer, focus back on the menu button', async () => {
		const { drawer, opener } = await openDrawer();
		await fireEvent.click(within(drawer).getByRole('button', { name: 'Workspace: Japanese' }));
		expect(get(workspaces).current?.id).toBe(2);
		expect(screen.queryByRole('dialog')).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('+ links to Settings → Workspaces (the new-workspace form)', async () => {
		const { drawer } = await openDrawer();
		const add = within(drawer).getByRole('link', { name: 'Add workspace' });
		expect(add.getAttribute('href')).toBe('/settings?tab=workspaces#new-workspace');
	});

	it('names the current workspace and its language under the row', async () => {
		const { drawer } = await openDrawer();
		expect(drawer.querySelector('.ws-name')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Novels Chinese');
	});

	it('sections with icon and label, Home first, aria-current on the current one', async () => {
		const { drawer } = await openDrawer('reader');
		const nav = within(drawer).getByRole('navigation', { name: 'Main' });
		const links = within(nav).getAllByRole('link');
		expect(links.map((l) => l.textContent?.trim())).toEqual(['Home', 'Decks', 'Reader', 'Journal', 'Grammar', 'Search', 'Stats']);
		expect(links[0].getAttribute('href')).toBe('/');
		for (const link of links) expect(link.querySelector('svg')).not.toBeNull();
		expect(links.map((l) => l.getAttribute('aria-current'))).toEqual([null, null, 'page', null, null, null, null]);
	});

	it('following a link closes the drawer', async () => {
		const { drawer } = await openDrawer();
		const nav = within(drawer).getByRole('navigation', { name: 'Main' });
		const link = within(nav).getByRole('link', { name: 'Stats' });
		link.addEventListener('click', (e) => e.preventDefault());
		await fireEvent.click(link);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('the account at the bottom: avatar opens the account menu (Admin for admins), name shown, Settings link', async () => {
		signIn(true);
		const { drawer } = await openDrawer();
		const foot = drawer.querySelector('.account') as HTMLElement;
		expect(foot.textContent).toContain('mei');
		expect(within(foot).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
		await fireEvent.click(within(foot).getByRole('button', { name: 'Account menu' }));
		const menu = within(foot).getByRole('menu', { name: 'Account menu' });
		expect(within(menu).getByRole('menuitem', { name: 'Admin settings' })).toBeTruthy();
		// Escape closes the menu only, not the drawer.
		await fireEvent.keyDown(menu, { key: 'Escape' });
		expect(within(foot).queryByRole('menu')).toBeNull();
		expect(screen.getByRole('dialog', { name: 'Menu' })).toBeTruthy();
	});

	it('Escape closes it and focus returns to the menu button', async () => {
		const { drawer, opener } = await openDrawer();
		await fireEvent.keyDown(drawer, { key: 'Escape' });
		expect(screen.queryByRole('dialog')).toBeNull();
		await waitFor(() => expect(document.activeElement).toBe(opener));
	});

	it('with no workspace, the row holds only + and focus starts on the first control', async () => {
		workspaces.set({ list: [], current: null });
		const { drawer } = await openDrawer();
		const row = within(drawer).getByRole('group', { name: 'Workspaces' });
		expect(within(row).queryAllByRole('button')).toEqual([]);
		await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
	});
});
