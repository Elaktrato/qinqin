import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/account/signOut', () => ({ requestSignOut: vi.fn(() => Promise.resolve()) }));

import { requestSignOut } from '$lib/account/signOut';
import type { ListedTheme } from '$lib/api/themes';
import { auth, type User } from '$lib/auth';
import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { createThemeStore, type ThemeStore } from '$lib/theme/store.svelte';
import AccountMenu from './AccountMenu.svelte';

const latte: ListedTheme = { ...FALLBACK_THEMES[0], family: 'Catppuccin', packId: 'catppuccin', builtin: true };
const mocha: ListedTheme = { ...FALLBACK_THEMES[1], family: 'Catppuccin', packId: 'catppuccin', builtin: true };
const root = document.documentElement;

function me(admin = false, restriction: User['restriction'] = ''): User {
	return {
		id: 1,
		username: 'mei',
		admin,
		email: null,
		emailVerified: false,
		mustChangePassword: false,
		createdAt: 't',
		restriction
	};
}

async function store(): Promise<ThemeStore> {
	const s = createThemeStore({
		fetchThemes: vi.fn(async () => ({ themes: [latte, mocha], packs: [] })),
		loadRow: vi.fn(async () => ({ version: 1, mode: 'light' })),
		saveRow: vi.fn(async () => {}),
		storage: () => null,
		media: () => null,
		root: () => root
	});
	await s.start();
	await s.setUser(1);
	return s;
}

async function mount(user: User, restricted = false) {
	auth.set({ token: 'tok', user });
	render(AccountMenu, { store: await store(), restricted });
	const trigger = screen.getByRole('button', { name: 'Account menu' });
	return trigger;
}

const names = () => screen.getAllByRole('menuitem').map((i) => i.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => root.removeAttribute('style'));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	auth.set({ token: null, user: null });
	root.removeAttribute('style');
});

describe('AccountMenu', () => {
	it('the avatar trigger is named "Account menu", has a tooltip and shows the initial (decorative)', async () => {
		const trigger = await mount(me());
		expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
		const avatar = trigger.querySelector('.avatar');
		expect(avatar?.textContent?.trim()).toBe('M');
		expect(avatar?.getAttribute('aria-hidden')).toBe('true');
		expect(trigger.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe('Account menu');
	});

	it('lists the name (not an item), Settings, Theme · current, Sources and Sign out', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		const menu = screen.getByRole('menu', { name: 'Account menu' });
		const group = menu.querySelector('[role="group"]') as HTMLElement;
		expect(group.getAttribute('aria-labelledby')).toBeTruthy();
		expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent?.trim()).toBe('mei');
		expect(names()).toEqual(['Settings', 'Theme Latte', 'Sources', 'Sign out']);
		expect(screen.getByRole('menuitem', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
		expect(screen.getByRole('menuitem', { name: 'Sources' }).getAttribute('href')).toBe('/sources');
		// Laid out as "Theme   Latte ›", named as one phrase.
		expect(screen.getByRole('menuitem', { name: 'Theme: Latte' })).toBeTruthy();
	});

	it('Admin settings only for admins', async () => {
		const trigger = await mount(me(true));
		await fireEvent.click(trigger);
		expect(names()).toEqual(['Settings', 'Theme Latte', 'Admin settings', 'Sources', 'Sign out']);
		expect(screen.getByRole('menuitem', { name: 'Admin settings' }).getAttribute('href')).toBe('/settings?tab=admin');
	});

	it('Theme opens the theme level in place: Back, the painted slot as radio items, Appearance settings…', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		const menu = screen.getByRole('menu', { name: 'Account menu' });
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		expect(screen.getByRole('menu', { name: 'Account menu' })).toBe(menu);
		expect(names()).toEqual(['Back', 'Appearance settings…']);
		expect(screen.getAllByRole('menuitemradio').map((r) => r.textContent?.trim())).toEqual(['Latte']);
		await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Back'));
	});

	it('ArrowLeft or Back returns to the first level with focus on Theme', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Back'));
		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
		await waitFor(() => expect(document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Theme Latte'));
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }));
		await waitFor(() => expect(document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Theme Latte'));
	});

	it('reopening after leaving at the theme level starts at the first level', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
		await fireEvent.click(trigger);
		expect(names()).toEqual(['Settings', 'Theme Latte', 'Sources', 'Sign out']);
	});

	it('Sign out calls requestSignOut', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
		expect(requestSignOut).toHaveBeenCalledTimes(1);
	});

	it('a restricted session gets Sources and Sign out only', async () => {
		const trigger = await mount(me(false, 'password_change'), true);
		await fireEvent.click(trigger);
		expect(names()).toEqual(['Sources', 'Sign out']);
		// The open Sources page stays reachable (the old footer linked it).
		expect(screen.getByRole('menuitem', { name: 'Sources' }).getAttribute('href')).toBe('/sources');
		expect(screen.queryAllByRole('menuitemradio')).toEqual([]);
	});
});
