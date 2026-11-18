// The Week tab's paired bars: last week's 35 % muted wash is 1.54-2.07:1 on
// --panel in the built-in themes, below the 3:1 non-text check. The bars and
// the legend swatch therefore carry a --muted outline, which is at least 3:1
// on every built-in panel (4.37 Latte, 7.37 Mocha, 5.30 Gruvbox, 5.54 Nord;
// minimum 3.03 Dracula). The visible chart stays decorative; the screen-reader
// list and the titles keep every number.
import { describe, expect, it } from 'vitest';
import { ratio } from '$lib/theme/contrast';
import { BUILTIN_THEMES } from '$lib/theme/testing/builtinThemes';
import bars from './WeekBars.svelte?raw';

const styleOf = (source: string): string => source.slice(source.indexOf('<style>'));

describe('last week’s bars', () => {
	it('outline the bar itself and the legend swatch in --muted', () => {
		const css = styleOf(bars);
		expect(css).toMatch(/\.bar\.last\s*\{[^}]*box-shadow:\s*inset 0 0 0 1px var\(--muted\)/);
		expect(css).toMatch(/\.key\.last\s*\{[^}]*border:\s*1px solid var\(--muted\)/);
	});

	it('--muted is at least 3:1 on every built-in panel', () => {
		for (const theme of BUILTIN_THEMES) {
			expect(
				ratio(theme.colors.muted, theme.colors.panel),
				`${theme.id}: --muted on --panel`
			).toBeGreaterThanOrEqual(3);
		}
	});

	it('keeps every day’s words in the title and the screen-reader list', () => {
		expect(bars).toMatch(/title=\{label\}/);
		expect(bars).toMatch(/<ul class="sr-only">/);
	});
});
