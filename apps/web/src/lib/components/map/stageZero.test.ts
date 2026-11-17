// Mastery stage 0 ("not studied") against stage 1: the ramp's first two
// steps (--mastery-0 = hair, --mastery-1 = accent at 14%) are about 1.0-1.05:1
// apart in every theme, so colour cannot tell them apart. Stage 0 is drawn as
// the contract says -- no fill, an outline -- and the outline is dashed in
// --muted (a shape cue) wherever a stage is shown: the grid cell, the legend
// swatches, the stacked bar.
import { describe, expect, it } from 'vitest';
import grid from './CharGrid.svelte?raw';
import bar from './StageBar.svelte?raw';
import summary from '../../widgets/CharacterMapSummary.svelte?raw';
import page from '../../../routes/stats/characters/+page.svelte?raw';

/** The declarations of the rules whose selector ends in `.st-unknown`. */
function unknown(src: string): string {
	const css = src.slice(src.indexOf('<style>'));
	return [...css.matchAll(/[^{}]*\.st-unknown\s*\{([^}]*)\}/g)].map((m) => m[1]).join(';');
}

describe.each([
	['CharGrid', grid],
	['StageBar', bar],
	['CharacterMapSummary', summary],
	['stats/characters', page]
])('%s', (_name, src) => {
	it('draws stage 0 without the ramp fill, with a dashed outline', () => {
		const d = unknown(src);
		expect(d).not.toMatch(/--mastery-0|--st-unknown-bar/);
		expect(d).toMatch(/dashed/);
	});
});
