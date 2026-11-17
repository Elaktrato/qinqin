// Each highlight colour is painted from its own token (--highlight-<name>,
// docs/contracts/themes/README.md `highlights`), never from a role colour
// (accent, good, a grade) that some themes make identical or another hue:
// what a swatch shows is what its accessible name says.
import { describe, expect, it } from 'vitest';
import chapterText from './ChapterText.svelte?raw';
import editor from './HighlightEditor.svelte?raw';
import bar from './HighlightBar.svelte?raw';
import panel from './HighlightsPanel.svelte?raw';
import { HIGHLIGHT_COLORS } from './highlights';

const css = (src: string) => src.slice(src.indexOf('<style>'));

/** The declarations of every rule whose selector names `.<colour>`. */
function rules(src: string, colour: string): string[] {
	const out: string[] = [];
	const re = new RegExp(`[^{}]*\\.${colour}\\b[^{}]*\\{([^}]*)\\}`, 'g');
	for (const m of css(src).matchAll(re)) out.push(m[1].trim());
	return out;
}

describe.each([
	['ChapterText', chapterText],
	['HighlightEditor', editor],
	['HighlightBar', bar],
	['HighlightsPanel', panel]
])('%s', (_name, src) => {
	it.each(HIGHLIGHT_COLORS)('%s uses its own --highlight token', (colour) => {
		const found = rules(src, colour);
		expect(found.length).toBeGreaterThan(0);
		for (const body of found) {
			expect(body).not.toMatch(/--accent|--good|--grade-|--warn\b/);
			expect(body).toMatch(colour === 'yellow' ? /--highlight-(yellow|wash)/ : new RegExp(`--highlight-${colour}`));
		}
	});
});
