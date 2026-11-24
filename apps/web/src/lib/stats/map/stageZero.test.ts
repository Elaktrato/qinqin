// Mastery stage 0 ("not studied") against stage 1: the ramp's first two
// steps (--mastery-0 = hair, --mastery-1 = accent at 14%) are about 1.0-1.05:1
// apart in every theme, so colour cannot tell them apart. Stage 0 is drawn
// as the contract says -- no fill, an outline -- and the outline carries a
// shape cue. Its colour is --muted, at least 3:1 on the panel in every
// built-in theme; --line is a 1.33-2.79:1 hairline in 14 of 15 (Dracula 3.03).
// The map cell is the
// design's 1px solid outline (mock .mc.m0), the legend/bar swatches dashed.
import { describe, expect, it } from 'vitest';
import { ratio } from '$lib/theme/contrast';
import { BUILTIN_THEMES } from '$lib/theme/testing/builtinThemes';
import grid from './CharGrid.svelte?raw';
import bar from './StageBar.svelte?raw';
import summary from '$lib/widgets/CharacterMapSummary.svelte?raw';
import tip from './CellTip.svelte?raw';
import page from '../../../routes/stats/characters/+page.svelte?raw';

/** The declarations of the rules whose selector ends in `.st-unknown`. */
function unknown(src: string): string {
	const css = src.slice(src.indexOf('<style>'));
	return [...css.matchAll(/[^{}]*\.st-unknown\s*\{([^}]*)\}/g)].map((m) => m[1]).join(';');
}

describe.each([
	['CharGrid', grid],
	['StageBar', bar],
	['CellTip', tip],
	['stats/characters', page]
])('%s', (_name, src) => {
	it('draws stage 0 without the ramp fill', () => {
		const d = unknown(src);
		expect(d).not.toMatch(/--mastery-0|--st-unknown-bar/);
		expect(d).toMatch(/transparent/);
	});

	it('draws stage 0 as a shape cue', () => {
		const d = unknown(src);
		expect(d).toMatch(/box-shadow|outline|dashed|dotted/);
	});
});

describe('the map cell and its legend cues', () => {
	it('the cell is the design’s 1px inset outline, in the ≥ 3:1 --muted edge', () => {
		expect(unknown(grid)).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--muted\)/);
	});

	it.each([
		['CharGrid', grid],
		['StageBar', bar],
		['CellTip', tip],
		['stats/characters', page]
	])('%s’s stage-0 outline names --muted', (_name, src) => {
		expect(unknown(src)).toMatch(/--muted/);
	});

	it('CharacterMapSummary’s stage-0 edge is --muted', () => {
		expect(summary).toMatch(/--st-unknown-edge:\s*var\(--muted\)/);
	});

	it('--muted is at least 3:1 on every built-in panel', () => {
		for (const theme of BUILTIN_THEMES) {
			expect(
				ratio(theme.colors.muted, theme.colors.panel),
				`${theme.id}: --muted on --panel`
			).toBeGreaterThanOrEqual(3);
		}
	});

	it.each([
		['StageBar', bar],
		['CharacterMapSummary', summary],
		['stats/characters', page]
	])('%s keeps a dashed stage-0 swatch', (_name, src) => {
		expect(unknown(src)).toMatch(/dashed/);
	});
});
