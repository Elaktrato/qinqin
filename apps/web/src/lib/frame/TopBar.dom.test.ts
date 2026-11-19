import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auth } from '$lib/auth';
import { FLASHCARDS_ID, READER_ID } from '$lib/features';
import { workspaces } from '$lib/workspaces';
import { currentSection, frameSections } from './sections';
import TopBar from './TopBar.svelte';

const sections = frameSections({
	list: [
		{ id: FLASHCARDS_ID, manifest: {}, enabled: true, order: 0 },
		{ id: READER_ID, manifest: {}, enabled: true, order: 0 },
		{ id: 'qinqin-journal', manifest: {}, enabled: true, order: 0 },
		{ id: 'qinqin-grammar', manifest: {}, enabled: true, order: 1 }
	],
	status: 'ready'
});

function mount(path: string) {
	return render(TopBar, { sections, current: currentSection(path, sections) });
}

beforeEach(() => {
	auth.set({
		token: 'tok',
		user: { id: 1, username: 'mei', admin: false, email: null, emailVerified: false, mustChangePassword: false, createdAt: 't' }
	});
	workspaces.set({ list: [{ id: 1, language: 'zh', name: '', settings: {}, updatedAt: '' }], current: null });
});
afterEach(() => {
	cleanup();
	auth.set({ token: null, user: null });
});

describe('TopBar', () => {
	it('the logo is the Home link named "qinqin, home" with a "Home" tooltip, current on /', () => {
		const { container } = mount('/');
		const logo = screen.getByRole('link', { name: 'qinqin, home' });
		expect(logo.getAttribute('href')).toBe('/');
		expect(logo.getAttribute('aria-current')).toBe('page');
		expect(logo.hasAttribute('title')).toBe(false);
		expect(logo.querySelector('svg')?.getAttribute('width')).toBe('40');
		expect(logo.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe('Home');
		expect(container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
	});

	it('sections render as icon-only links with tooltips, in frameSections order', () => {
		mount('/settings');
		const nav = screen.getByRole('navigation', { name: 'Main' });
		const links = within(nav).getAllByRole('link');
		expect(links.map((l) => l.getAttribute('aria-label'))).toEqual(['Search', 'Decks', 'Reader', 'Journal', 'Grammar', 'Stats']);
		expect(links.map((l) => l.getAttribute('href'))).toEqual(['/search', '/flashcards', '/reader', '/p/journal', '/p/grammar', '/stats']);
		for (const link of links) {
			expect(link.textContent?.trim()).toBe('');
			expect(link.querySelector('svg')).not.toBeNull();
			expect(link.parentElement?.querySelector('[role="tooltip"]')?.textContent).toBe(link.getAttribute('aria-label'));
		}
		expect(nav.querySelector('[aria-current]')).toBeNull();
		expect(screen.getByRole('link', { name: 'qinqin, home' }).hasAttribute('aria-current')).toBe(false);
	});

	it('the current section has aria-current="page" and the dot', () => {
		mount('/stats/week');
		const nav = screen.getByRole('navigation', { name: 'Main' });
		const current = within(nav).getByRole('link', { name: 'Stats' });
		expect(current.getAttribute('aria-current')).toBe('page');
		const dots = nav.querySelectorAll('.dot');
		expect(dots).toHaveLength(1);
		expect(dots[0].getAttribute('aria-hidden')).toBe('true');
		expect(current.closest('.section')?.contains(dots[0])).toBe(true);
	});

	it('flag and avatar sit after the nav, in that order', () => {
		const { container } = mount('/');
		const nav = screen.getByRole('navigation', { name: 'Main' });
		const flag = screen.getByRole('button', { name: /^Workspace:/ });
		const avatar = screen.getByRole('button', { name: 'Account menu' });
		const order = [...container.querySelectorAll('a, button')];
		expect(order.indexOf(flag)).toBeGreaterThan(order.indexOf(nav.querySelector('a:last-of-type') as Element));
		expect(order.indexOf(avatar)).toBeGreaterThan(order.indexOf(flag));
		expect(nav.contains(flag)).toBe(false);
	});

	it('the flag and avatar tooltips open toward the start (never past the window edge)', () => {
		mount('/');
		for (const name of [/^Workspace:/, /^Account menu$/]) {
			const tip = screen.getByRole('button', { name }).parentElement?.querySelector('[role="tooltip"]');
			expect(tip?.classList.contains('below-end')).toBe(true);
		}
	});
});
