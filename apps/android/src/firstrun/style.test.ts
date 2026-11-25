import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The first-run screen is in the house theme: its colours are the compiled-in qinqin Day and Night tokens of the
// web app (apps/web/src/lib/theme/fallback.ts). This fails when they drift apart.
const fallback = readFileSync(new URL('../../../web/src/lib/theme/fallback.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

function slot(id: string): Record<string, string> {
	const block = fallback.slice(fallback.indexOf(`id: '${id}'`));
	const colors = block.slice(block.indexOf('colors: {'), block.indexOf('},', block.indexOf('colors: {')));
	const accents = block.slice(block.indexOf('accents: {'), block.indexOf('},', block.indexOf('accents: {')));
	const out: Record<string, string> = {};
	for (const m of colors.matchAll(/(\w+): '(#[0-9a-f]{6})'/g)) out[m[1]] = m[2];
	const first = /\w+: '(#[0-9a-f]{6})'/.exec(accents);
	out.accent = first![1];
	return out;
}

function cssSlot(dark: boolean): Record<string, string> {
	const root = dark ? css.slice(css.indexOf('prefers-color-scheme: dark')) : css.slice(0, css.indexOf('@media'));
	const body = dark ? root.slice(0, root.indexOf('}\n}')) : root;
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/--([\w-]+): (#[0-9a-f]{6});/g)) out[m[1]] = m[2];
	return out;
}

describe('first-run screen theme', () => {
	for (const [id, dark] of [
		['qinqin-day', false],
		['qinqin-night', true]
	] as const) {
		it(`${id} colours match the web app's compiled-in theme`, () => {
			const theme = slot(id);
			const mine = cssSlot(dark);
			for (const key of ['chrome', 'panel', 'raised', 'line', 'text', 'muted', 'good', 'warn', 'bad']) {
				expect(mine[key], key).toBe(theme[key]);
			}
			// the default accent of the theme (qinqin Day azure, qinqin Night cyan)
			expect(mine.accent).toBe(theme.accent);
		});
	}
});
