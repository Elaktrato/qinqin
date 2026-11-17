import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FALLBACK_THEMES, fallbackTheme } from './fallback';

const repo = resolve(__dirname, '../../../../..');
const builtin = JSON.parse(
	readFileSync(resolve(repo, 'server/internal/themes/builtin/catppuccin/themes.json'), 'utf8')
) as Array<{ id: string }>;

describe('compiled-in fallback themes', () => {
	it('are Catppuccin Latte and Mocha exactly as the built-in pack ships them (no copy drift)', () => {
		const want = builtin.filter((th) => th.id === 'catppuccin-latte' || th.id === 'catppuccin-mocha');
		expect(want).toHaveLength(2);
		expect(FALLBACK_THEMES).toEqual(want);
		// Accent order is part of the theme (file order).
		for (const th of FALLBACK_THEMES) {
			const file = want.find((w) => w.id === th.id) as unknown as { accents: Record<string, string> };
			expect(Object.keys(th.accents)).toEqual(Object.keys(file.accents));
		}
	});

	it('picks the slot default by scheme', () => {
		expect(fallbackTheme('light').id).toBe('catppuccin-latte');
		expect(fallbackTheme('dark').id).toBe('catppuccin-mocha');
	});

	it('ships the Catppuccin licence text the built-in pack carries, byte for byte', () => {
		const pack = readFileSync(resolve(repo, 'server/internal/themes/builtin/catppuccin/LICENSE'), 'utf8');
		const shipped = readFileSync(resolve(repo, 'apps/web/static/CATPPUCCIN-LICENSE.TXT'), 'utf8');
		expect(shipped).toBe(pack);
		expect(shipped).toContain('MIT License');
	});
});
