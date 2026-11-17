import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { getThemes, parseThemesAnswer } from './themes';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const latte = { ...FALLBACK_THEMES[0], packId: 'catppuccin', builtin: true };
const mocha = { ...FALLBACK_THEMES[1], packId: 'catppuccin', builtin: true };
const pack = {
	packId: 'catppuccin',
	name: 'Catppuccin',
	version: '1.0',
	license: 'MIT',
	attribution: '© 2021 Catppuccin (catppuccin/palette)',
	notice: 'The four flavours.',
	licenseText: 'MIT License\n\nCopyright (c) 2021 Catppuccin\n',
	builtin: true,
	themes: ['catppuccin-latte', 'catppuccin-mocha']
};

describe('parseThemesAnswer', () => {
	it('keeps valid themes and packs in order, accents in their order', () => {
		const out = parseThemesAnswer({ themes: [latte, mocha], packs: [pack] });
		expect(out.themes.map((t) => t.id)).toEqual(['catppuccin-latte', 'catppuccin-mocha']);
		expect(Object.keys(out.themes[0].accents)).toEqual(Object.keys(latte.accents));
		expect(out.themes[0]).toMatchObject({ packId: 'catppuccin', builtin: true, family: 'Catppuccin' });
		expect(out.packs).toEqual([pack]);
	});

	it('reads a pack without a licence text (an installed pack, an older server) as ""', () => {
		const { licenseText: _, ...installed } = pack;
		expect(parseThemesAnswer({ themes: [], packs: [installed] }).packs[0].licenseText).toBe('');
	});

	it('drops a broken entry and keeps the rest', () => {
		const broken = [
			{ ...mocha, id: 'Bad Id' },
			{ ...mocha, id: 'x1', colors: { ...mocha.colors, panel: 'red' } },
			{ ...mocha, id: 'x2', colors: { ...mocha.colors, panel: undefined } },
			{ ...mocha, id: 'x3', accents: {} },
			{ ...mocha, id: 'x4', defaultAccent: 'nope' },
			{ ...mocha, id: 'x5', scheme: 'sepia' },
			{ ...mocha, id: 'x6', name: '' },
			{ ...mocha, id: 'x7', accents: { mauve: '#CBA6F7' } },
			// An inherited property name is not an accent of the theme.
			{ ...mocha, id: 'x8', defaultAccent: 'constructor' },
			null,
			'nord'
		];
		const out = parseThemesAnswer({ themes: [latte, ...broken], packs: [pack, { packId: 1 }, null] });
		expect(out.themes.map((t) => t.id)).toEqual(['catppuccin-latte']);
		expect(out.packs).toEqual([pack]);
	});

	it('reads a theme without family as family ""; a duplicate id keeps the first', () => {
		const { family: _f, ...noFamily } = { ...mocha, id: 'solo' };
		const out = parseThemesAnswer({ themes: [noFamily, { ...noFamily, name: 'Again' }], packs: [] });
		expect(out.themes).toHaveLength(1);
		expect(out.themes[0].family).toBe('');
		expect(out.themes[0].name).toBe('Mocha');
	});

	it('answers empty lists for anything that is not the answer', () => {
		expect(parseThemesAnswer(null)).toEqual({ themes: [], packs: [] });
		expect(parseThemesAnswer({ themes: 'x' })).toEqual({ themes: [], packs: [] });
	});
});

describe('getThemes', () => {
	beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
	afterEach(() => vi.unstubAllGlobals());

	it('requests GET /api/themes', async () => {
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ themes: [latte], packs: [pack] }));
		const out = await getThemes();
		const url = new URL(String(vi.mocked(fetch).mock.calls[0][0]), 'http://localhost');
		expect(url.pathname).toBe('/api/themes');
		expect(out.themes).toHaveLength(1);
	});

	it('rejects on a network failure', async () => {
		vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
		await expect(getThemes()).rejects.toBeTruthy();
	});
});
