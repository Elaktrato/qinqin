import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedTheme } from '$lib/api/themes';
import { FALLBACK_THEMES } from './fallback';
import { createThemeStore, type ThemeStore, type ThemeStoreDeps } from './store.svelte';
import ThemeSwitch from './ThemeSwitch.svelte';

const latte: ListedTheme = { ...FALLBACK_THEMES[0], family: 'Catppuccin', packId: 'catppuccin', builtin: true };
const mocha: ListedTheme = { ...FALLBACK_THEMES[1], family: 'Catppuccin', packId: 'catppuccin', builtin: true };
const nord: ListedTheme = {
	...mocha,
	id: 'nord',
	name: 'Nord',
	family: '',
	colors: { ...mocha.colors, panel: '#2e3440' },
	accents: { frost: '#88c0d0', mauve: '#b48ead' },
	defaultAccent: 'frost'
};

const root = document.documentElement;
let deps: ThemeStoreDeps;
let store: ThemeStore;

async function setup(row: unknown, opts: { saveFails?: boolean; rowFails?: boolean } = {}) {
	deps = {
		fetchThemes: vi.fn(async () => ({ themes: [latte, mocha, nord], packs: [] })),
		loadRow: vi.fn(async () => {
			if (opts.rowFails) throw new Error('offline');
			return row;
		}),
		saveRow: vi.fn(async () => {
			if (opts.saveFails) throw new Error('offline');
		}),
		storage: () => null,
		media: () => null,
		root: () => root
	};
	store = createThemeStore(deps);
	await store.start();
	await store.setUser(1);
	render(ThemeSwitch, { store });
}

beforeEach(() => root.removeAttribute('style'));
afterEach(() => {
	cleanup();
	root.removeAttribute('style');
});

describe('quick theme switch', () => {
	it('is a named menu button with a tooltip, closed at first', async () => {
		await setup({ version: 1, mode: 'dark' });
		const button = screen.getByRole('button', { name: 'Theme: Mocha' });
		expect(button.getAttribute('aria-haspopup')).toBe('menu');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(button.getAttribute('title')).toBe('Theme: Mocha');
		expect(screen.queryByRole('menu')).toBeNull();
	});

	it('lists the themes of the painted slot with the current one checked, plus Appearance settings', async () => {
		await setup({ version: 1, mode: 'dark' });
		await fireEvent.click(screen.getByRole('button', { name: 'Theme: Mocha' }));
		const items = screen.getAllByRole('menuitemradio');
		expect(items.map((i) => i.textContent?.trim())).toEqual(['Mocha', 'Nord']);
		expect(items[0].getAttribute('aria-checked')).toBe('true');
		const settings = screen.getByRole('menuitem', { name: 'Appearance settings…' });
		expect(settings.getAttribute('href')).toBe('/settings?tab=appearance');
		await waitFor(() => expect(document.activeElement).toBe(items[0]));
	});

	it('picking a theme writes the slot (an offered accent kept) and repaints', async () => {
		await setup({ version: 1, mode: 'dark', dark: { theme: 'catppuccin-mocha', accent: 'mauve' }, future: 1 });
		await fireEvent.click(screen.getByRole('button', { name: 'Theme: Mocha' }));
		await fireEvent.click(screen.getByRole('menuitemradio', { name: 'Nord' }));
		await waitFor(() => expect(deps.saveRow).toHaveBeenCalledTimes(1));
		expect(deps.saveRow).toHaveBeenCalledWith(
			expect.objectContaining({ dark: { theme: 'nord', accent: 'mauve' }, future: 1, mode: 'dark' })
		);
		expect(root.style.getPropertyValue('--panel')).toBe('#2e3440');
		expect(screen.queryByRole('menu')).toBeNull();
		expect(screen.getByRole('button', { name: 'Theme: Nord' })).toBeTruthy();
	});

	it('moves with the arrow keys, Home and End; Escape closes and returns focus', async () => {
		await setup({ version: 1, mode: 'dark' });
		const button = screen.getByRole('button', { name: 'Theme: Mocha' });
		await fireEvent.click(button);
		const menu = screen.getByRole('menu');
		const items = [...screen.getAllByRole('menuitemradio'), screen.getByRole('menuitem')];
		await waitFor(() => expect(document.activeElement).toBe(items[0]));
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items[1]);
		await fireEvent.keyDown(menu, { key: 'End' });
		expect(document.activeElement).toBe(items[2]);
		await fireEvent.keyDown(menu, { key: 'ArrowDown' });
		expect(document.activeElement).toBe(items[0]);
		await fireEvent.keyDown(menu, { key: 'Escape' });
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(button);
	});

	it('a failed save is announced and the theme stays', async () => {
		await setup({ version: 1, mode: 'dark' }, { saveFails: true });
		await fireEvent.click(screen.getByRole('button', { name: 'Theme: Mocha' }));
		await fireEvent.click(screen.getByRole('menuitemradio', { name: 'Nord' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Could not change the theme. Try again.');
		expect(root.style.getPropertyValue('--panel')).toBe('#1e1e2e');
	});

	it('without the saved row, offers only the settings link', async () => {
		await setup(null, { rowFails: true });
		await fireEvent.click(screen.getByRole('button', { name: /^Theme/ }));
		expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
		expect(screen.getByRole('menuitem', { name: 'Appearance settings…' })).toBeTruthy();
	});
});
