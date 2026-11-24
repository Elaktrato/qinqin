// The heatmap tint ramp over every built-in theme and every accent it offers
// (#100 review). The tiles sit on `panel`. LEVELS mirrors the tile rules of
// ActivityHeatmap.svelte's <style>; the first test pins it to the source, the
// others measure it with the TS derivation (docs/contracts/themes/README.md).
//
// Thresholds:
// - level 0 vs level 4 ≥ 3:1 (WCAG 1.4.11 non-text; the plan's bar).
// - the level 0 → 1 step: level 0 is an empty tile drawn by a hairline ring
//   (`--hair` over `panel`, ≥ 1.15:1 on panel), level 1 a ring-less filled
//   tile (fill ≥ 1.05:1 on panel). The step is carried by the shape (outlined
//   box → filled patch) where the 14 % fill is faint (Solarized Dark).
import { describe, expect, it } from 'vitest';
import source from './ActivityHeatmap.svelte?raw';
import { MIN_GRAPH, ratio } from '$lib/theme/contrast';
import { accentChoices, cssVariables, derive, type TokenName } from '$lib/theme/derive';
import { BUILTIN_THEMES, over } from '$lib/theme/testing/builtinThemes';

const css = source.slice(source.indexOf('<style>'), source.indexOf('@media (forced-colors'));

function decls(selector: string): Record<string, string> {
	const i = css.indexOf(`\n\t${selector} {`);
	expect(i, selector).toBeGreaterThan(-1);
	const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
	const out: Record<string, string> = {};
	for (const d of body.split(';')) {
		const m = /^\s*([a-z-]+):\s*([\s\S]+?)\s*$/.exec(d);
		if (m) out[m[1]] = m[2];
	}
	return out;
}

const LEVELS: { background: TokenName; ring: TokenName | null }[] = [
	{ background: '--panel', ring: '--hair' },
	{ background: '--accent-14', ring: null },
	{ background: '--accent-32', ring: null },
	{ background: '--accent-58', ring: null },
	{ background: '--accent-100', ring: null }
];
const RING_MIN = 1.15;
const FILL_MIN = 1.05;

describe('heatmap tint ramp', () => {
	it('LEVELS mirrors the tile rules', () => {
		const base = decls('.heatmap :global(.tile)');
		expect(base.background).toBe(`var(${LEVELS[0].background})`);
		expect(base['box-shadow']).toBe(`inset 0 0 0 1px var(${LEVELS[0].ring})`);
		for (let level = 1; level <= 4; level++) {
			const rule = decls(`.heatmap :global(.tile.level-${level})`);
			expect(rule.background).toBe(`var(${LEVELS[level].background})`);
			expect(rule['box-shadow']).toBe('none');
		}
	});

	it("today's ring is doubled: a --panel gap, then the accent (#100 review), so it shows on a level-4 tile too", () => {
		expect(decls('.heatmap :global(.tile.today)')['box-shadow']).toBe('0 0 0 1.5px var(--panel), 0 0 0 3px var(--accent)');
		const forced = source.slice(source.indexOf('@media (forced-colors'));
		expect(forced).toMatch(/\.heatmap :global\(\.tile\.today\) \{\s*outline: 2px solid Highlight;\s*outline-offset: 1px;/);
	});

	for (const theme of BUILTIN_THEMES) {
		for (const accent of accentChoices(theme)) {
			it(`${theme.id} / ${accent}: level 0 vs 4 ≥ 3:1 and a visible 0 → 1 step`, () => {
				const vars = cssVariables(theme, derive(theme, accent));
				const panel = vars['--panel'];
				const at = (token: TokenName) => over(vars[token], panel);
				const l0 = at(LEVELS[0].background);
				expect(ratio(l0, at(LEVELS[4].background))).toBeGreaterThanOrEqual(MIN_GRAPH);
				expect(ratio(at(LEVELS[0].ring!), l0)).toBeGreaterThanOrEqual(RING_MIN);
				expect(ratio(at(LEVELS[1].background), l0)).toBeGreaterThanOrEqual(FILL_MIN);
			});
		}
	}
});
