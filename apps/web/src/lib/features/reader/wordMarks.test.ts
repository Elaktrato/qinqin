// The reader's word marks, highlights and looked-up word (#102, design §6
// "reader word marks", "highlight wash"): the global rules in app.css (shared
// with the Display legend and the Appearance preview) and ChapterText's own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import chapterSource from './ChapterText.svelte?raw';

const appCss = readFileSync(join(__dirname, '..', '..', '..', 'app.css'), 'utf8');
const chapterCss = chapterSource.slice(chapterSource.indexOf('<style>'));

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string {
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const selectors = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
		if (selectors === selector) return m[2];
	}
	throw new Error(`no rule ${selector}`);
}

function forced(css: string): string {
	const at = css.indexOf('@media (forced-colors: active)');
	expect(at).toBeGreaterThanOrEqual(0);
	// Up to the next top-level rule after the block (good enough for these files).
	return css.slice(at);
}

describe('reader word marks', () => {
	it('.w-new draws one 1.5px solid --accent line and no tint layer', () => {
		const r = rule(appCss, '.w-new');
		expect(r).toMatch(/linear-gradient\(var\(--accent\), var\(--accent\)\)/);
		expect(r).toMatch(/background-size:\s*100% 1\.5px/);
		expect(r.match(/gradient\(/g)).toHaveLength(1);
	});

	it('.w-learning draws one 1.5px dotted --warn line and no tint layer', () => {
		const r = rule(appCss, '.w-learning');
		expect(r).toMatch(/repeating-linear-gradient\(90deg, var\(--warn\) 0 3px, transparent 3px 6px\)/);
		expect(r).toMatch(/background-size:\s*100% 1\.5px/);
		expect(r.match(/gradient\(/g)).toHaveLength(1);
	});

	it('the forced-colours block keeps solid vs dotted text-decoration in CanvasText', () => {
		const block = forced(appCss.slice(appCss.indexOf('.w-new')));
		expect(block).toMatch(/text-decoration-color:\s*CanvasText/);
		expect(rule(block, '.w-new')).toMatch(/text-decoration-style:\s*solid/);
		expect(rule(block, '.w-learning')).toMatch(/text-decoration-style:\s*dotted/);
	});

	it('no tint custom properties (--word-new, --word-learning) remain', () => {
		expect(appCss).not.toMatch(/--word-(new|learning)\b/);
		expect(chapterCss).not.toMatch(/--word-(new|learning)\b/);
	});
});

describe('the looked-up word and highlights', () => {
	it('the looked-up word uses --selected-wash, and Highlight/HighlightText in forced colours', () => {
		expect(chapterCss).toMatch(/::highlight\(reader-lookup\)\)\s*\{[^}]*background-color:\s*var\(--selected-wash\)/);
		const block = forced(chapterCss);
		expect(block).toMatch(/::highlight\(reader-lookup\)\)\s*\{[^}]*background-color:\s*Highlight;[^}]*color:\s*HighlightText/);
	});

	it('yellow highlights use --highlight-wash, and Mark/MarkText in forced colours', () => {
		expect(rule(chapterCss, 'mark.yellow')).toMatch(/background:\s*var\(--highlight-wash\)/);
		const block = forced(chapterCss);
		expect(block).toMatch(/mark\.hl\s*\{[^}]*background:\s*Mark;[^}]*color:\s*MarkText/);
	});
});
