import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ListedTheme } from '$lib/api/themes';
import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { createThemeStore, type ThemeStore, type ThemeStoreDeps } from '$lib/theme/store.svelte';
import { installedFaces, type InstalledFaces } from '$lib/fonts/hanzi';
import AppearanceSettings from './AppearanceSettings.svelte';

const latte: ListedTheme = { ...FALLBACK_THEMES[0], family: FALLBACK_THEMES[0].family ?? '', packId: 'qinqin', builtin: true };
const mocha: ListedTheme = { ...FALLBACK_THEMES[1], family: FALLBACK_THEMES[1].family ?? '', packId: 'qinqin', builtin: true };
const nord: ListedTheme = {
	...mocha,
	id: 'nord',
	name: 'Nord',
	family: '',
	packId: 'nord',
	colors: { ...mocha.colors, panel: '#2e3440' },
	accents: { frost: '#88c0d0', glacier: '#81a1c1' },
	defaultAccent: 'frost'
};

const root = document.documentElement;
const panel = () => root.style.getPropertyValue('--panel');
let deps: ThemeStoreDeps;
let store: ThemeStore;

async function setup(
	row: unknown = null,
	saveRow: ThemeStoreDeps['saveRow'] = async () => {},
	installed: InstalledFaces = installedFaces([])
): Promise<void> {
	deps = {
		fetchThemes: vi.fn(async () => ({ themes: [latte, mocha, nord], packs: [] })),
		loadRow: vi.fn(async () => row),
		saveRow: vi.fn(saveRow),
		storage: () => null,
		media: () => null,
		root: () => root
	};
	store = createThemeStore(deps);
	await store.start();
	await store.setUser(1);
	render(AppearanceSettings, { store, installed });
}

beforeEach(() => root.removeAttribute('style'));
afterEach(() => {
	cleanup();
	root.removeAttribute('style');
});

describe('Settings → Appearance', () => {
	it('shows every group as a labelled radio group with the saved choice checked', async () => {
		await setup({ version: 1, mode: 'dark', dark: { theme: 'nord', accent: 'glacier' }, corners: 'round' });
		expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
		const mode = screen.getByRole('group', { name: 'Mode' });
		expect((within(mode).getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
		const dark = screen.getByRole('group', { name: 'Dark theme' });
		expect((within(dark).getByRole('radio', { name: 'Nord' }) as HTMLInputElement).checked).toBe(true);
		const darkAccent = screen.getByRole('group', { name: 'Dark theme accent' });
		expect((within(darkAccent).getByRole('radio', { name: 'Accent glacier' }) as HTMLInputElement).checked).toBe(true);
		const corners = screen.getByRole('group', { name: 'Corners' });
		expect((within(corners).getByRole('radio', { name: 'Round' }) as HTMLInputElement).checked).toBe(true);
		expect(screen.getByRole('group', { name: 'Spacing' })).toBeTruthy();
		const hanzi = screen.getByRole('group', { name: 'Hanzi and kanji font' });
		// Applied now (#97): no "from a coming update" hint any more.
		expect(within(hanzi).queryByText(/coming update/)).toBeNull();
	});

	it('the preview shows hanzi and kanji in each script, tagged with its study lang', async () => {
		await setup();
		const preview = screen.getByRole('region', { name: 'Preview' });
		const samples = [...preview.querySelectorAll('.hanzi [lang]')].map((e) => [e.getAttribute('lang'), e.textContent]);
		expect(samples).toEqual([
			['zh-Hans', '汉字'],
			['zh-Hant', '漢字'],
			['ja', 'かな漢字']
		]);
	});

	it('says when the chosen face has no font pack, describing the group by it', async () => {
		await setup();
		const hanzi = screen.getByRole('group', { name: 'Hanzi and kanji font' });
		const hint = within(hanzi).getByText("Uses your device's fonts; an administrator can install a font pack.");
		expect(hanzi.getAttribute('aria-describedby')).toBe(hint.id);
	});

	it('names no hint when a pack provides the chosen face', async () => {
		await setup(null, async () => {}, installedFaces([{ face: 'sans', script: 'Jpan' }]));
		const hanzi = screen.getByRole('group', { name: 'Hanzi and kanji font' });
		expect(within(hanzi).queryByText(/font pack/)).toBeNull();
		expect(hanzi.hasAttribute('aria-describedby')).toBe(false);
		await fireEvent.click(within(hanzi).getByRole('radio', { name: 'Kai' }));
		expect(within(hanzi).getByText(/font pack/)).toBeTruthy();
	});

	it('offers only accents at 3:1 on panel, each named with a tooltip', async () => {
		await setup();
		const accents = screen.getByRole('group', { name: 'Light theme accent' });
		const names = within(accents)
			.getAllByRole('radio')
			.map((r) => r.getAttribute('aria-label'));
		expect(names).toEqual(['Accent azure', 'Accent blue', 'Accent navy', 'Accent teal', 'Accent violet', 'Accent pink']);
		for (const radio of within(accents).getAllByRole('radio')) {
			expect(radio.closest('label')?.getAttribute('title')).toBeTruthy();
		}
	});

	it('previews a change live without saving, and reverts when the page closes unsaved', async () => {
		await setup();
		expect(panel()).toBe('#ffffff');
		const dark = screen.getByRole('group', { name: 'Dark theme' });
		await fireEvent.click(within(dark).getByRole('radio', { name: 'Nord' }));
		// The slot being edited is previewed, even on a light device.
		expect(panel()).toBe('#2e3440');
		expect(deps.saveRow).not.toHaveBeenCalled();
		cleanup();
		expect(panel()).toBe('#ffffff');
	});

	it('saves the whole draft to the row (unknown members kept) and announces it', async () => {
		await setup({ version: 1, mode: 'system', future: { x: 1 } });
		await fireEvent.click(within(screen.getByRole('group', { name: 'Spacing' })).getByRole('radio', { name: 'Compact' }));
		await fireEvent.click(within(screen.getByRole('group', { name: 'Hanzi and kanji font' })).getByRole('radio', { name: 'Kai' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(deps.saveRow).toHaveBeenCalledTimes(1));
		expect(deps.saveRow).toHaveBeenCalledWith(
			expect.objectContaining({ version: 1, spacing: 'compact', hanziFont: 'kai', future: { x: 1 } })
		);
		expect(await screen.findByText('Appearance saved.')).toBeTruthy();
		expect(root.style.getPropertyValue('--space')).toBe('0.75');
	});

	it('a failed save says so and keeps the draft previewed', async () => {
		await setup(null, async () => {
			throw new Error('offline');
		});
		await fireEvent.click(within(screen.getByRole('group', { name: 'Corners' })).getByRole('radio', { name: 'Sharp' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
		expect(await screen.findByText('Could not save your appearance. Try again.')).toBeTruthy();
		expect((within(screen.getByRole('group', { name: 'Corners' })).getByRole('radio', { name: 'Sharp' }) as HTMLInputElement).checked).toBe(true);
		expect(root.style.getPropertyValue('--radius')).toBe('4px');
		expect(store.row).toBeNull();
	});

	it('Reset puts the defaults in the draft; Discard returns to the saved choice', async () => {
		await setup({ version: 1, mode: 'dark', corners: 'round' });
		await fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
		expect((within(screen.getByRole('group', { name: 'Mode' })).getByRole('radio', { name: 'System' }) as HTMLInputElement).checked).toBe(true);
		expect((within(screen.getByRole('group', { name: 'Corners' })).getByRole('radio', { name: 'Soft' }) as HTMLInputElement).checked).toBe(true);
		await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
		expect((within(screen.getByRole('group', { name: 'Corners' })).getByRole('radio', { name: 'Round' }) as HTMLInputElement).checked).toBe(true);
		expect(deps.saveRow).not.toHaveBeenCalled();
	});

	it('shows a live preview sample with the grades and the reader marks', async () => {
		await setup();
		const preview = screen.getByRole('region', { name: 'Preview' });
		for (const grade of ['Again', 'Hard', 'Good', 'Easy']) expect(within(preview).getByText(grade)).toBeTruthy();
		expect(preview.querySelector('.w-new')).not.toBeNull();
		expect(preview.querySelector('.w-learning')).not.toBeNull();
	});
});
