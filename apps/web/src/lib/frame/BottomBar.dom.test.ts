import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/state', () => import('$lib/testing/appState.svelte'));

import { setUrl } from '$lib/testing/appState.svelte';
import BottomBar from './BottomBar.svelte';
import { DEFAULT_BAR } from './navLayout';
import { homeSection, type FrameSection } from './sections';

const S = (id: string, label: string, icon = 'plugin'): FrameSection =>
	({ id, label, href: id === 'home' ? '/' : `/${id}`, icon, match: [`/${id}`] }) as FrameSection;

const four = [homeSection(), S('search', 'Search', 'search'), S('flashcards', 'Decks', 'study'), S('reader', 'Reader', 'reader')];
const five = [...four, S('stats', 'Stats', 'stats')];
const seven = [...four.slice(0, 4), S('journal', 'Journal', 'journal'), S('grammar', 'Grammar', 'grammar'), S('stats', 'Stats', 'stats')];

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function items(nav: HTMLElement): string[] {
	return [...nav.querySelectorAll('li')].map((li) => li.textContent?.trim() ?? '');
}

describe('BottomBar', () => {
	it('is a nav landmark named like the desktop bar, with icon and label items in pin order', () => {
		setUrl('/reader');
		render(BottomBar, { sections: four, bar: DEFAULT_BAR, current: 'reader' });
		const nav = screen.getByRole('navigation', { name: 'Main' });
		expect(items(nav)).toEqual(['Home', 'Decks', 'Reader', 'Search']);
		for (const link of within(nav).getAllByRole('link')) {
			expect(link.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
			expect(link.querySelector('.label')?.textContent).toBeTruthy();
		}
		expect(within(nav).queryByRole('button', { name: 'More' })).toBeNull();
	});

	it('marks only the current item: aria-current="page"', () => {
		setUrl('/reader');
		render(BottomBar, { sections: five, bar: DEFAULT_BAR, current: 'reader' });
		const nav = screen.getByRole('navigation', { name: 'Main' });
		expect(items(nav)).toEqual(['Home', 'Decks', 'Reader', 'Search', 'Stats']);
		const current = within(nav)
			.getAllByRole('link')
			.filter((a) => a.getAttribute('aria-current') === 'page');
		expect(current.map((a) => a.textContent)).toEqual(['Reader']);
	});

	it('four pins and More when the sections do not fit; More is a button that opens the sheet', async () => {
		setUrl('/');
		render(BottomBar, { sections: seven, bar: DEFAULT_BAR, current: 'home' });
		const nav = screen.getByRole('navigation', { name: 'Main' });
		expect(items(nav)).toEqual(['Home', 'Decks', 'Reader', 'Search', 'More']);
		const more = within(nav).getByRole('button', { name: 'More' });
		expect(more.getAttribute('aria-haspopup')).toBe('dialog');
		expect(more.getAttribute('aria-expanded')).toBe('false');
		expect(more.hasAttribute('aria-current')).toBe(false);
		await fireEvent.click(more);
		const sheet = await screen.findByRole('dialog', { name: 'More' });
		expect(more.getAttribute('aria-expanded')).toBe('true');
		const links = within(sheet).getAllByRole('link');
		expect(links.map((a) => a.textContent)).toEqual(['Journal', 'Grammar', 'Stats', 'Edit the bar']);
		expect(links.at(-1)!.getAttribute('href')).toBe('/settings?tab=layout#bottom-bar');
	});

	it('More is current on a page of one of its rows, and the sheet marks that row', async () => {
		setUrl('/journal');
		render(BottomBar, { sections: seven, bar: DEFAULT_BAR, current: 'journal' });
		const more = screen.getByRole('button', { name: 'More' });
		expect(more.getAttribute('aria-current')).toBe('true');
		expect(
			screen
				.getAllByRole('link')
				.filter((a) => a.getAttribute('aria-current'))
				.map((a) => a.textContent)
		).toEqual([]);
		await fireEvent.click(more);
		const sheet = await screen.findByRole('dialog', { name: 'More' });
		expect(within(sheet).getByRole('link', { name: 'Journal' }).getAttribute('aria-current')).toBe('page');
		expect(within(sheet).getByRole('link', { name: 'Grammar' }).hasAttribute('aria-current')).toBe(false);
	});

	it('choosing a row closes the sheet; so does a navigation', async () => {
		setUrl('/');
		const { rerender } = render(BottomBar, { sections: seven, bar: DEFAULT_BAR, current: 'home' });
		await fireEvent.click(screen.getByRole('button', { name: 'More' }));
		const sheet = await screen.findByRole('dialog', { name: 'More' });
		await fireEvent.click(within(sheet).getByRole('link', { name: 'Stats' }));
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

		await fireEvent.click(screen.getByRole('button', { name: 'More' }));
		await screen.findByRole('dialog', { name: 'More' });
		setUrl('/stats');
		await rerender({ sections: seven, bar: DEFAULT_BAR, current: 'stats' });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});

	it('Escape closes the sheet and focus returns to More', async () => {
		setUrl('/');
		render(BottomBar, { sections: seven, bar: DEFAULT_BAR, current: 'home' });
		const more = screen.getByRole('button', { name: 'More' });
		more.focus();
		await fireEvent.click(more);
		const sheet = await screen.findByRole('dialog', { name: 'More' });
		await fireEvent.keyDown(sheet, { key: 'Escape' });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(more));
	});

	it('every item is a real link or button (keyboard reachable, no tabindex tricks)', () => {
		setUrl('/');
		render(BottomBar, { sections: seven, bar: DEFAULT_BAR, current: 'home' });
		const nav = screen.getByRole('navigation', { name: 'Main' });
		const controls = [...nav.querySelectorAll('a[href], button')];
		expect(controls).toHaveLength(5);
		expect(nav.querySelectorAll('[tabindex]')).toHaveLength(0);
	});

	it('steps aside while a text field has focus on a touch screen (the on-screen keyboard)', async () => {
		vi.stubGlobal('matchMedia', (q: string) => ({
			matches: q === '(pointer: coarse)',
			addEventListener() {},
			removeEventListener() {}
		}));
		setUrl('/');
		const field = document.createElement('input');
		document.body.append(field);
		try {
			const { container } = render(BottomBar, { sections: four, bar: DEFAULT_BAR, current: 'home' });
			const nav = container.querySelector('nav') as HTMLElement;
			expect(nav.classList.contains('keyboard')).toBe(false);
			field.focus();
			await waitFor(() => expect(nav.classList.contains('keyboard')).toBe(true));
			field.blur();
			await waitFor(() => expect(nav.classList.contains('keyboard')).toBe(false));
		} finally {
			field.remove();
		}
	});

	it('leaving the phone frame (rotation, resize) closes the More sheet', async () => {
		const listeners: ((e: { matches: boolean }) => void)[] = [];
		vi.stubGlobal('matchMedia', () => ({
			matches: true,
			addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
			removeEventListener() {}
		}));
		setUrl('/');
		render(BottomBar, { sections: seven, bar: DEFAULT_BAR, current: 'home' });
		await fireEvent.click(screen.getByRole('button', { name: 'More' }));
		await screen.findByRole('dialog', { name: 'More' });
		for (const fn of listeners) fn({ matches: false });
		await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
	});
});
