import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '$lib/auth';
import { FLASHCARDS_ID, READER_ID } from '$lib/features';
import { workspaces } from '$lib/workspaces';
import { PHONE_MEDIA_QUERY } from './breakpoint';
import { frameSections } from './sections';
import PhoneHarness from './testing/PhoneHarness.svelte';

const sections = frameSections({
	list: [
		{ id: FLASHCARDS_ID, manifest: {}, enabled: true, order: 0 },
		{ id: READER_ID, manifest: {}, enabled: true, order: 0 }
	],
	status: 'ready'
});

beforeEach(() => {
	auth.set({
		token: 'tok',
		user: { id: 1, username: 'mei', admin: false, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' }
	});
	const zh = { id: 1, language: 'zh', name: '', settings: {}, updatedAt: '' };
	workspaces.set({ list: [zh], current: zh });
});
afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	auth.set({ token: null, user: null });
});

describe('PhoneBar', () => {
	it('menu button named "Open menu" with a tooltip, aria-expanded, and aria-controls the drawer while open', async () => {
		render(PhoneHarness, { sections, current: 'reader' });
		const button = screen.getByRole('button', { name: 'Open menu' });
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(button.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe('Open menu');
		await fireEvent.click(button);
		const drawer = await screen.findByRole('dialog', { name: 'Menu' });
		expect(button.getAttribute('aria-expanded')).toBe('true');
		expect(button.getAttribute('aria-controls')).toBe(drawer.id);
	});

	it('the page title is plain text (pages keep their own h1): the section label', () => {
		const { container } = render(PhoneHarness, { sections, current: 'reader' });
		const title = container.querySelector('.title') as HTMLElement;
		expect(title.textContent).toBe('Reader');
		expect(title.tagName).not.toMatch(/^H\d$/);
		expect(container.querySelector('h1, h2, [role="heading"]')).toBeNull();
	});

	it('the order is menu button, title, page actions, flag', async () => {
		const { container } = render(PhoneHarness, { sections, current: 'reader', page: true });
		const order = [...container.querySelector('.phone-bar')!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent);
		expect(order).toEqual(['Open menu', 'Add to deck', 'Workspace: Chinese']);
	});

	it('the flag opens the workspace menu', async () => {
		render(PhoneHarness, { sections, current: null });
		await fireEvent.click(screen.getByRole('button', { name: 'Workspace: Chinese' }));
		expect(screen.getByRole('menu', { name: 'Workspaces' })).toBeTruthy();
	});

	it('a page sets the title and the actions; leaving the page takes both away', async () => {
		const view = render(PhoneHarness, { sections, current: 'search', page: true, title: true });
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
			render(PhoneHarness, { sections, current: 'reader' });
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
		render(PhoneHarness, { sections, current: 'reader' });
		await fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
		expect(await screen.findByRole('dialog', { name: 'Menu' })).toBeTruthy();
	});
});
