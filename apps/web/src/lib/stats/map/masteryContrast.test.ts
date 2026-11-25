// The Characters tab's contrast: the mastery ramp is a fill, so a glyph on
// the 14-100 % tint cannot reach 4.5:1 with either text token (the 58 %
// step is 2.76-4.17 in the built-in themes). The cell therefore backs the
// glyph with a --panel tile and writes it in --text: the effective pair is
// the theme contract's own text/panel check. Stage 0's outline and the
// legend/bar swatches use --muted, which is at least 3:1 on --panel.
import { describe, expect, it } from 'vitest';
import { ratio } from '$lib/theme/contrast';
import { BUILTIN_THEMES } from '$lib/theme/testing/builtinThemes';
import grid from './CharGrid.svelte?raw';
import bar from './StageBar.svelte?raw';
import tip from './CellTip.svelte?raw';
import page from '../../../routes/stats/characters/+page.svelte?raw';

const styleOf = (source: string): string => source.slice(source.indexOf('<style>'));
const mapSources: [string, string][] = [
	['CharGrid', grid],
	['StageBar', bar],
	['CellTip', tip],
	['stats/characters', page]
];

describe('mastery text contrast (the plan’s m0-m4 ≥ 4.5:1 check)', () => {
	it('backs the glyph with --panel and writes it in --text', () => {
		const css = styleOf(grid);
		expect(grid).toMatch(/<span class="glyph">\{cell\.char\.c\}<\/span>/);
		expect(css).toMatch(/\.glyph\s*\{[^}]*background:\s*var\(--panel\)/);
		for (const stage of ['fresh', 'learning', 'mature', 'learned']) {
			expect(css).toMatch(new RegExp(`\\.st-${stage}\\s*\\{[^}]*color:\\s*var\\(--text\\)`));
		}
		expect(css).not.toMatch(/\.st-mature\s*\{[^}]*--on-accent/);
	});

	it('every built-in theme’s text on panel is at least 4.5:1 (the glyph’s effective pair)', () => {
		for (const theme of BUILTIN_THEMES) {
			expect(
				ratio(theme.colors.text, theme.colors.panel),
				`${theme.id}: --text on --panel`
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	it('stage 0 keeps no ramp fill: its outlined tile is transparent', () => {
		expect(styleOf(grid)).toMatch(/\.st-unknown\s*\{[^}]*background:\s*transparent/);
		expect(styleOf(grid)).toMatch(/\.st-unknown\s+\.glyph\s*\{[^}]*background:\s*transparent/);
	});

	it('the stage-0 outlines use --muted, at least 3:1 on every built-in panel', () => {
		for (const theme of BUILTIN_THEMES) {
			expect(
				ratio(theme.colors.muted, theme.colors.panel),
				`${theme.id}: --muted on --panel`
			).toBeGreaterThanOrEqual(3);
		}
		for (const [name, source] of mapSources) {
			expect(source, `${name} names --muted for stage 0`).toMatch(/--muted/);
		}
	});

	it('gives each 30 px phone cell a --hit target on coarse pointers', () => {
		const css = styleOf(grid);
		expect(css).toMatch(/@media \(pointer: coarse\)/);
		expect(css).toMatch(/--hit/);
		expect(css).toMatch(/\.glyph::before\s*\{[^}]*inset:/);
	});
});
