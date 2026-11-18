import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { goto } = vi.hoisted(() => ({ goto: vi.fn() }));
vi.mock('$app/navigation', () => ({ goto }));

import { FALLBACK_THEMES } from '$lib/theme/fallback';
import { getThemes, parseThemesAnswer } from './themes';

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const day = { ...FALLBACK_THEMES[0], packId: 'qinqin', builtin: true };
const night = { ...FALLBACK_THEMES[1], packId: 'qinqin', builtin: true };
const pack = {
	packId: 'qinqin',
	name: 'qinqin',
	version: '1.0',
	license: 'MIT',
	attribution: '© 2026 qinqin',
	notice: 'The house themes.',
	licenseText: 'MIT License\n\nCopyright (c) 2026 qinqin\n',
	builtin: true,
	themes: ['qinqin-day', 'qinqin-night']
};

describe('parseThemesAnswer', () => {
	it('keeps valid themes and packs in order, accents in their order', () => {
		const out = parseThemesAnswer({ themes: [day, night], packs: [pack] });
		expect(out.themes.map((t) => t.id)).toEqual(['qinqin-day', 'qinqin-night']);
		expect(Object.keys(out.themes[0].accents)).toEqual(Object.keys(day.accents));
		expect(out.themes[0]).toMatchObject({ packId: 'qinqin', builtin: true, family: 'qinqin' });
		expect(out.packs).toEqual([pack]);
	});

	it('reads a pack without a licence text (an installed pack, an older server) as ""', () => {
		const { licenseText: _, ...installed } = pack;
		expect(parseThemesAnswer({ themes: [], packs: [installed] }).packs[0].licenseText).toBe('');
	});

	it('drops a broken entry and keeps the rest', () => {
		const broken = [
			{ ...night, id: 'Bad Id' },
			{ ...night, id: 'x1', colors: { ...night.colors, panel: 'red' } },
			{ ...night, id: 'x2', colors: { ...night.colors, panel: undefined } },
			{ ...night, id: 'x3', accents: {} },
			{ ...night, id: 'x4', defaultAccent: 'nope' },
			{ ...night, id: 'x5', scheme: 'sepia' },
			{ ...night, id: 'x6', name: '' },
			{ ...night, id: 'x7', accents: { mauve: '#CBA6F7' } },
			// An inherited property name is not an accent of the theme.
			{ ...night, id: 'x8', defaultAccent: 'constructor' },
			null,
			'nord'
		];
		const out = parseThemesAnswer({ themes: [day, ...broken], packs: [pack, { packId: 1 }, null] });
		expect(out.themes.map((t) => t.id)).toEqual(['qinqin-day']);
		expect(out.packs).toEqual([pack]);
	});

	it('reads a theme without family as family ""; a duplicate id keeps the first', () => {
		const { family: _f, ...noFamily } = { ...night, id: 'solo' };
		const out = parseThemesAnswer({ themes: [noFamily, { ...noFamily, name: 'Again' }], packs: [] });
		expect(out.themes).toHaveLength(1);
		expect(out.themes[0].family).toBe('');
		expect(out.themes[0].name).toBe('qinqin Night');
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
		vi.mocked(fetch).mockResolvedValue(jsonResponse({ themes: [day], packs: [pack] }));
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
