import { testContext, type TestContext } from '$lib/testing/context';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLASHCARDS_ID, READER_ID } from '$lib/features';
import { PHONE_MEDIA_QUERY } from './breakpoint';
import { frameSections } from './sections';
import PhoneHarness from './testing/PhoneHarness.svelte';
import source from './PhoneBar.svelte?raw';

let ctx: TestContext = testContext();
beforeEach(() => {
	ctx = testContext();
});

const sections = frameSections({
	list: [
		{ id: FLASHCARDS_ID, enabled: true },
		{ id: READER_ID, enabled: true }
	],
	status: 'ready'
});

beforeEach(() => {
	ctx.app.auth.set({
		token: 'tok',
		user: { id: 1, username: 'mei', admin: false, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' }
	});
	const zh = { id: 1, language: 'zh', name: '', settings: {}, updatedAt: '' };
	ctx.session.workspaces.set({ list: [zh], current: zh });
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	ctx.app.auth.set({ token: null, user: null });
});

describe('PhoneBar', () => {
	it('menu button named "Open menu" with a tooltip, aria-expanded, and aria-controls the drawer while open', async () => {
		render(PhoneHarness, { props: { sections, current: 'reader' }, context: ctx.context });
		const button = screen.getByRole('button', { name: 'Open menu' });
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(button.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe('Open menu');
		await fireEvent.click(button);
		const drawer = await screen.findByRole('dialog', { name: 'Menu' });
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(button.getAttribute('aria-controls')).toBe(drawer.id);
	});

	it('the page title is plain text (pages keep their own h1): the section label', () => {
		const { container } = render(PhoneHarness, { props: { sections, current: 'reader' }, context: ctx.context });
		const title = container.querySelector('.title') as HTMLElement;
		expect(title.textContent).toBe('Reader');
		expect(title.tagName).not.toMatch(/^H\d$/);
		expect(container.querySelector('h1, h2, [role="heading"]')).toBeNull();
	});

	it('the order is menu button, title, page actions, flag', async () => {
		const { container } = render(PhoneHarness, { props: { sections, current: 'reader', page: true }, context: ctx.context });
		const order = [...container.querySelector('.phone-bar')!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
		expect(order).toEqual(['Open menu', 'Add to deck', 'Workspace: Chinese']);
	});

	it('the flag opens the workspace menu', async () => {
		render(PhoneHarness, { props: { sections, current: null }, context: ctx.context });
		await fireEvent.click(screen.getByRole('button', { name: 'Workspace: Chinese' }));
		expect(screen.getByRole('menu', { name: 'Workspaces' })).toBeTruthy();
	});

	it('a page sets the title and the actions; leaving the page takes both away', async () => {
		const view = render(PhoneHarness, { props: { sections, current: 'search', page: true, title: true }, context: ctx.context });
		const bar = view.container.querySelector('.phone-bar') as HTMLElement;
		await waitFor(() => expect(bar.querySelector('.title')?.textContent).toBe('学习'));
		expect(within(bar).getByRole('button', { name: 'Add to deck' })).toBeTruthy();
		await view.rerender({ word: '学生' });
		await waitFor(() => expect(bar.querySelector('.title')?.textContent).toBe('学生'));
		await view.rerender({ page: false });
		await waitFor(() => expect(bar.querySelector('.title')?.textContent).toBe('Search'));
		expect(within(bar).queryByRole('button', { name: 'Add to deck' })).toBeNull();
	});

	it('the drawer closes when the window grows past the phone breakpoint; focus goes to the page', async () => {
		// The drawer is a modal dialog inside the phone bar, which is display: none
		// on the desktop frame: left open, it would keep the whole page inert.
		const listeners = new Set<(e: { matches: boolean }) => void>();
		const query = { matches: true, media: PHONE_MEDIA_QUERY };
		const matchMedia = vi.fn((q: string) => ({
			...query,
			media: q,
			get matches() {
				return query.matches;
			},
			addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.add(fn),
			removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.delete(fn)
		}));
		vi.stubGlobal('matchMedia', matchMedia);
		const main = document.createElement('main');
		main.id = 'main-content';
		main.tabIndex = -1;
		document.body.append(main);
		try {
			render(PhoneHarness, { props: { sections, current: 'reader' }, context: ctx.context });
			await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
			await screen.findByRole('dialog', { name: 'Menu' });
			expect(matchMedia).toHaveBeenCalledWith(PHONE_MEDIA_QUERY);
			expect(listeners.size).toBe(1);
			query.matches = false;
			for (const fn of [...listeners]) fn({ matches: false });
			await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
			expect(screen.getByRole('button', { name: 'Open menu' }).getAttribute('aria-expanded')).toBe('false');
			// The menu button is hidden with the phone bar: focus lands on the page.
			await waitFor(() => expect(document.activeElement).toBe(main));
			expect(listeners.size).toBe(0);
		} finally {
			main.remove();
		}
	});

	it('without matchMedia the drawer still opens', async () => {
		vi.stubGlobal('matchMedia', undefined);
		render(PhoneHarness, { props: { sections, current: 'reader' }, context: ctx.context });
		await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		expect(await screen.findByRole('dialog', { name: 'Menu' })).toBeTruthy();
	});
});

describe('PhoneBar in bottom-bar mode (#188)', () => {
	it('logo, page actions, flag, avatar: no menu button, no drawer and no title (#293)', async () => {
		const { container } = render(PhoneHarness, { props: { sections, current: 'reader', page: true, mode: 'bar' }, context: ctx.context });
		const bar = container.querySelector('.phone-bar') as HTMLElement;
		const order = [...bar.querySelectorAll('a, button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
		expect(order).toEqual(['qinqin, home', 'Add to deck', 'Workspace: Chinese', 'Account menu']);
		expect(screen.queryByRole('button', { name: 'Open menu' })).toBeNull();
		expect(bar.querySelector('.title')).toBeNull();
		expect(bar.textContent).not.toContain('Reader');
	});

	it('the logo is a link to Home named "qinqin, home", the first focusable item, current only on Home', async () => {
		const view = render(PhoneHarness, { props: { sections, current: 'reader', mode: 'bar' }, context: ctx.context });
		const bar = view.container.querySelector('.phone-bar') as HTMLElement;
		const logo = within(bar).getByRole('link', { name: 'qinqin, home' });
		expect(logo.getAttribute('href')).toBe('/');
		expect(logo.querySelector('svg.logo')).toBeTruthy();
		expect(logo.getAttribute('aria-current')).toBeNull();
		expect(bar.querySelector('a[href], button, input, select, textarea, [tabindex]')).toBe(logo);
		await view.rerender({ sections, current: 'home', mode: 'bar' });
		expect(logo.getAttribute('aria-current')).toBe('page');
	});

	it('a page with its own title shows only the logo; the title stays the page\'s own heading', async () => {
		const view = render(PhoneHarness, { props: { sections, current: 'search', page: true, title: true, mode: 'bar' }, context: ctx.context });
		const bar = view.container.querySelector('.phone-bar') as HTMLElement;
		await waitFor(() => expect(within(bar).getByRole('button', { name: 'Add to deck' })).toBeTruthy());
		expect(bar.textContent).not.toContain('学习');
		expect(bar.textContent).not.toContain('Search');
		expect(within(bar).getByRole('link', { name: 'qinqin, home' })).toBeTruthy();
		expect(bar.querySelector('h1, h2, [role="heading"]')).toBeNull();
	});

	it('the logo link is a 44 px touch target in the 3 rem bar', () => {
		const css = source.slice(source.indexOf('<style>'));
		expect(css).toMatch(/\.brand\s*\{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem/);
		expect(css).toMatch(/\.phone-bar\s*\{[^}]*min-height:\s*3rem/);
	});

	it('the avatar opens the account menu (Settings within reach without the drawer)', async () => {
		render(PhoneHarness, { props: { sections, current: null, mode: 'bar' }, context: ctx.context });
		await fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
		expect(screen.getByRole('menuitem', { name: 'Settings' }).getAttribute('href')).toBe('/settings');
	});

	it('side-menu mode is unchanged: menu button first, the title, no logo and no avatar in the bar', async () => {
		const { container, rerender } = render(PhoneHarness, { props: { sections, current: 'reader', mode: 'drawer' }, context: ctx.context });
		const bar = container.querySelector('.phone-bar') as HTMLElement;
		const order = [...bar.querySelectorAll('a, button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
		expect(order).toEqual(['Open menu', 'Workspace: Chinese']);
		expect(bar.querySelector('.title')?.textContent).toBe('Reader');
		expect(within(bar).queryByRole('link', { name: 'qinqin, home' })).toBeNull();
		await rerender({ sections, current: 'search', page: true, title: true, mode: 'drawer' });
		await waitFor(() => expect(bar.querySelector('.title')?.textContent).toBe('学习'));
	});

	it('switching to bottom-bar mode closes an open drawer', async () => {
		const { rerender } = render(PhoneHarness, { props: { sections, current: 'reader', mode: 'drawer' }, context: ctx.context });
		await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		await screen.findByRole('dialog', { name: 'Menu' });
		await rerender({ sections, current: 'reader', mode: 'bar' });
		await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
	});
});
