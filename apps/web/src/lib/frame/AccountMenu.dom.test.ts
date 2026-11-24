import type { User } from '$lib/auth.svelte';
import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/account/signOut', () => ({ requestSignOut: vi.fn(() => Promise.resolve()) }));

import { requestSignOut } from '$lib/account/signOut';
import type { ListedTheme } from '$lib/api/themes';
import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { createThemeStore, type ThemeStore } from '$lib/theme/store.svelte';
import AccountMenu from './AccountMenu.svelte';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const latte: ListedTheme = { ...FALLBACK_THEMES[0], family: FALLBACK_THEMES[0].family ?? '', packId: 'qinqin', builtin: true };
const mocha: ListedTheme = { ...FALLBACK_THEMES[1], family: FALLBACK_THEMES[1].family ?? '', packId: 'qinqin', builtin: true };
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

async function store(failSave = false): Promise<ThemeStore> {
	const s = createThemeStore({
		fetchThemes: vi.fn(async () => ({ themes: [latte, mocha], packs: [] })),
		loadRow: vi.fn(async () => ({ version: 1, mode: 'light' })),
		saveRow: vi.fn(async () => {
			if (failSave) throw new Error('offline');
		}),
		storage: () => null,
		media: () => null,
		root: () => root
	});
	await s.start();
	await s.setUser(1);
	return s;
}

async function mount(user: User, restricted = false, failSave = false) {
	ctx.app.auth.set({ token: 'tok', user });
	render(AccountMenu, { props: { store: await store(failSave), restricted }, context: ctx.context });
	const trigger = screen.getByRole('button', { name: 'Account menu' });
	return trigger;
}

const names = () => screen.getAllByRole('menuitem').map((i) => i.textContent?.replace(/\s+/g, ' ').trim());

beforeEach(() => root.removeAttribute('style'));
afterEach(() => {
	vi.useRealTimers();
	cleanup();
	vi.clearAllMocks();
	ctx.app.auth.set({ token: null, user: null });
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
		expect(names()).toEqual(['Settings', 'Theme qinqin Day', 'Sources', 'Sign out']);
		expect(screen.getByRole('menuitem', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
		expect(screen.getByRole('menuitem', { name: 'Sources' }).getAttribute('href')).toBe('/sources');
		// Laid out as "Theme   Day ›", named as one phrase.
		expect(screen.getByRole('menuitem', { name: 'Theme: qinqin Day' })).toBeTruthy();
	});

	it('Admin settings only for admins', async () => {
		const trigger = await mount(me(true));
		await fireEvent.click(trigger);
		expect(names()).toEqual(['Settings', 'Theme qinqin Day', 'Admin settings', 'Sources', 'Sign out']);
		expect(screen.getByRole('menuitem', { name: 'Admin settings' }).getAttribute('href')).toBe('/settings?tab=admin');
	});

	it('Theme opens the theme level in place: Back, the painted slot as radio items, Appearance settings…', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		const menu = screen.getByRole('menu', { name: 'Account menu' });
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		expect(screen.getByRole('menu', { name: 'Account menu' })).toBe(menu);
		expect(names()).toEqual(['Back', 'Appearance settings…']);
		expect(screen.getAllByRole('menuitemradio').map((r) => r.textContent?.trim())).toEqual(['qinqin Day']);
		await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Back'));
	});

	it('ArrowLeft or Back returns to the first level with focus on Theme', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		await waitFor(() => expect(document.activeElement?.textContent?.trim()).toBe('Back'));
		await fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
		await waitFor(() => expect(document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Theme qinqin Day'));
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		await fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }));
		await waitFor(() => expect(document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Theme qinqin Day'));
	});

	it('reopening after leaving at the theme level starts at the first level', async () => {
		const trigger = await mount(me());
		await fireEvent.click(trigger);
		await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
		await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
		await fireEvent.click(trigger);
		expect(names()).toEqual(['Settings', 'Theme qinqin Day', 'Sources', 'Sign out']);
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

	describe('a failed theme change', () => {
		async function fail() {
			const trigger = await mount(me(), false, true);
			await fireEvent.click(trigger);
			await fireEvent.click(screen.getByRole('menuitem', { name: /^Theme/ }));
			await fireEvent.click(screen.getByRole('menuitemradio', { name: 'qinqin Day' }));
			await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Could not change the theme. Try again.'));
			return trigger;
		}

		it('the alert goes away on its own after a while', async () => {
			vi.useFakeTimers({ shouldAdvanceTime: true });
			await fail();
			await vi.advanceTimersByTimeAsync(7000);
			expect(screen.queryByRole('alert')).not.toBeNull();
			await vi.advanceTimersByTimeAsync(1500);
			expect(screen.queryByRole('alert')).toBeNull();
		});

		it('opening the menu again clears the alert', async () => {
			const trigger = await fail();
			// The pick closed the menu; the alert stays beside it.
			expect(screen.queryByRole('menu')).toBeNull();
			expect(screen.queryByRole('alert')).not.toBeNull();
			await fireEvent.click(trigger);
			await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		});
	});
});

describe('AccountMenu: the profile picture (#189)', () => {
	const url = '/api/avatars/1/0123456789abcdef0123456789abcdef';
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('jpg', { status: 200 })));
		Object.assign(URL, { createObjectURL: (() => { let n = 0; return () => `blob:pic-${++n}`; })(), revokeObjectURL: () => undefined });
	});
	afterEach(() => vi.unstubAllGlobals());

	it('shows the picture on the trigger and in the menu header from one fetch of the small file', async () => {
		ctx.app.auth.set({ token: 'tok', user: { ...me(), avatarUrl: url } });
		render(AccountMenu, { props: { store: await store() }, context: ctx.context });
		const trigger = screen.getByRole('button', { name: 'Account menu' });
		await waitFor(() => expect(trigger.querySelector('img')).not.toBeNull());
		await fireEvent.click(trigger);
		await waitFor(() => expect(document.querySelector('.who img')).not.toBeNull());
		// 28 and 36 CSS px on a 1x screen: both fit the 64 px file, fetched once for the session.
		expect(vi.mocked(fetch).mock.calls.map(([u]) => u)).toEqual([`${url}?size=64`]);
	});

	it('takes the 256 px file on a dense screen', async () => {
		Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true });
		try {
			ctx.app.auth.set({ token: 'tok', user: { ...me(), avatarUrl: url } });
			render(AccountMenu, { props: { store: await store() }, context: ctx.context });
			await waitFor(() => expect(fetch).toHaveBeenCalledWith(url, expect.anything()));
		} finally {
			Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
		}
	});

	it('loads no picture for a restricted session (its routes refuse it)', async () => {
		ctx.app.auth.set({ token: 'tok', user: { ...me(false, 'password_change'), avatarUrl: url } });
		render(AccountMenu, { props: { store: await store(), restricted: true }, context: ctx.context });
		expect(screen.getByRole('button', { name: /account/i }).textContent).toContain('M');
		expect(fetch).not.toHaveBeenCalled();
	});
});
