import { describe, expect, it } from 'vitest';
import type { ListedTheme } from '$lib/api/themes';
import { DEFAULT_APPEARANCE, parseAppearance } from '$lib/theme/appearance';
import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { accentOptions, changeFrom, isDirty, previewOf, slotThemeGroups } from './appearanceForm';

const t = (id: string, scheme: 'light' | 'dark', family: string, name = id): ListedTheme => ({
	...FALLBACK_THEMES[scheme === 'light' ? 0 : 1],
	id,
	name,
	family,
	scheme,
	packId: 'p',
	builtin: true
});

const themes = [
	t('catppuccin-latte', 'light', 'Catppuccin', 'Latte'),
	t('catppuccin-mocha', 'dark', 'Catppuccin', 'Mocha'),
	t('nord', 'dark', '', 'Nord'),
	t('rose-pine-dawn', 'light', 'Rosé Pine', 'Dawn'),
	t('rose-pine', 'dark', 'Rosé Pine', 'Rosé Pine')
];

describe('slotThemeGroups', () => {
	it('lists the themes of the slot scheme grouped by family, in list order', () => {
		expect(slotThemeGroups(themes, 'dark', 'nord')).toEqual([
			{ family: 'Catppuccin', themes: [themes[1]] },
			{ family: '', themes: [themes[2]] },
			{ family: 'Rosé Pine', themes: [themes[4]] }
		]);
		expect(slotThemeGroups(themes, 'light', 'catppuccin-latte').map((g) => g.family)).toEqual(['Catppuccin', 'Rosé Pine']);
	});

	it('keeps a chosen theme of the other scheme so the choice stays visible', () => {
		const groups = slotThemeGroups(themes, 'light', 'nord');
		expect(groups.flatMap((g) => g.themes.map((x) => x.id))).toEqual(['catppuccin-latte', 'nord', 'rose-pine-dawn']);
	});

	it('keeps the server list order, so the house family leads the picker', () => {
		const house = [
			{ ...FALLBACK_THEMES[0], family: FALLBACK_THEMES[0].family ?? '', packId: 'qinqin', builtin: true },
			{ ...FALLBACK_THEMES[1], family: FALLBACK_THEMES[1].family ?? '', packId: 'qinqin', builtin: true }
		];
		expect(slotThemeGroups([...house, ...themes], 'light', 'qinqin-day').map((g) => g.family)).toEqual([
			'qinqin',
			'Catppuccin',
			'Rosé Pine'
		]);
	});
});

describe('accentOptions', () => {
	it('offers only the accents at 3:1 or more on panel, in file order, with their colours', () => {
		const latte = FALLBACK_THEMES[0];
		const opts = accentOptions(latte);
		expect(opts.map((o) => o.key)).toEqual(['azure', 'blue', 'navy', 'teal', 'violet', 'pink']);
		expect(opts[0]).toEqual({ key: 'azure', color: '#0077b3' });
	});
});

describe('changeFrom / isDirty / previewOf', () => {
	it('writes every member of the draft', () => {
		const a = parseAppearance({ version: 1, mode: 'dark', dark: { theme: 'nord', accent: null }, corners: 'round' });
		expect(changeFrom(a)).toEqual({
			mode: 'dark',
			light: { theme: 'qinqin-day', accent: 'azure' },
			dark: { theme: 'nord', accent: null },
			corners: 'round',
			spacing: 'comfortable',
			hanziFont: 'sans'
		});
	});

	it('writes only the members that differ from the saved row (a whole slot when its theme or accent changed)', () => {
		const saved = parseAppearance(null);
		const draft = { ...saved, corners: 'round' as const, dark: { theme: 'nord', accent: null } };
		expect(changeFrom(draft, saved)).toEqual({ corners: 'round', dark: { theme: 'nord', accent: null } });
		expect(changeFrom(saved, saved)).toEqual({});
	});

	it('compares drafts by value', () => {
		const a = parseAppearance(null);
		expect(isDirty(a, parseAppearance(null))).toBe(false);
		expect(isDirty({ ...a, corners: 'sharp' }, a)).toBe(true);
		expect(isDirty({ ...a, dark: { ...a.dark, accent: 'blue' } }, a)).toBe(true);
	});

	it('previews the slot being edited, else the draft mode', () => {
		const a = { ...parseAppearance(null) };
		expect(previewOf(a, null).mode).toBe('system');
		expect(previewOf(a, 'dark').mode).toBe('dark');
		expect(previewOf(a, 'dark').dark).toEqual(DEFAULT_APPEARANCE.dark);
	});
});
