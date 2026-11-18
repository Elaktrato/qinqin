// Mastery stage 0 ("not studied") against stage 1: the ramp's first two
// steps (--mastery-0 = hair, --mastery-1 = accent at 14%) are about 1.0-1.05:1
// apart in every theme, so colour cannot tell them apart. Stage 0 is drawn
// as the contract says -- no fill, an outline -- and the outline carries a
// shape cue: the map cell is the design's 1px line (design §9 mock), the
// legend swatches and the stacked bar keep a dashed/dotted outline.
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
	it('draws stage 0 without the ramp fill', () => {
		const d = unknown(src);
		expect(d).not.toMatch(/--mastery-0|--st-unknown-bar/);
		expect(d).toMatch(/transparent/);
	});

	it('draws stage 0 as a visible outline', () => {
		const d = unknown(src);
		expect(d).toMatch(/box-shadow|outline|dashed|dotted/);
	});
});

describe('the map cell and its legend cues', () => {
	it('the cell is the design’s 1px inset line (mock: .mc.m0)', () => {
		expect(unknown(grid)).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--line\)/);
	});

	it.each([
		['StageBar', bar],
		['CharacterMapSummary', summary],
		['stats/characters', page]
	])('%s keeps a dashed stage-0 swatch', (_name, src) => {
		expect(unknown(src)).toMatch(/dashed/);
	});
});
