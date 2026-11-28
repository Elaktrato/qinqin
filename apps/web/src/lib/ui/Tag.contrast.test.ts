// Tag contrast (#286): an outline pill on the card background (`panel`). Its text must read at 4.5:1 and its
// outline, a graphic, at 3:1, in every built-in theme (house and extras) and every accent it offers. The tones
// are read from Tag.svelte's <style>, so a change of token is measured here.
import { describe, expect, it } from 'vitest';
import source from './Tag.svelte?raw';
import { MIN_GRAPH, MIN_TEXT, ratio } from '$lib/theme/contrast';
import { accentChoices, cssVariables, derive, type TokenName } from '$lib/theme/derive';
import { BUILTIN_THEMES, over } from '$lib/theme/testing/builtinThemes';

const css = source.slice(source.indexOf('<style>'), source.indexOf('@media'));

/** The declarations of the rule whose selector is exactly `selector`. */
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

/** The text colour and the outline colour of a tone, after the cascade. */
function paint(tone: 'neutral' | 'accent'): { text: string; outline: string; background: string } {
	const base = decls('.tag');
	const extra = tone === 'accent' ? decls('.accent') : {};
	const border = (extra.border ?? base.border ?? '').split(/\s+/);
	return {
		text: extra.color ?? base.color,
		outline: extra['border-color'] ?? border.at(-1) ?? '',
		background: extra.background ?? base.background
	};
}

function colour(value: string, vars: Record<TokenName, string>, panel: string): string {
	const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
	expect(m, `a token, not ${value}`).not.toBeNull();
	const v = vars[m![1] as TokenName];
	expect(v, m![1]).toBeTruthy();
	return over(v, panel);
}

describe('Tag paint (pinned to the source)', () => {
	it('an outline of 1px, no fill, rounded ends, in the label size', () => {
		const base = decls('.tag');
		expect(base.border).toMatch(/^1px solid var\(--/);
		expect(base.background).toBe('transparent');
		expect(base['border-radius']).toBe('999px');
		expect(base['font-size']).toBe('var(--font-size-label)');
	});

	it('forced colours draw the outline and text in system colours', () => {
		const forced = source.slice(source.indexOf('@media (forced-colors: active)'));
		expect(forced).toMatch(/border-color:\s*CanvasText/);
		expect(forced).toMatch(/color:\s*CanvasText/);
	});
});

const cases = BUILTIN_THEMES.flatMap((theme) =>
	accentChoices(theme).map((accent) => ({ id: `${theme.id}/${accent}`, theme, accent }))
);

describe.each(cases)('$id', ({ theme, accent }) => {
	const vars = cssVariables(theme, derive(theme, accent));
	const panel = theme.colors.panel;

	it.each(['neutral', 'accent'] as const)('%s: text 4.5:1, outline 3:1 on the card', (tone) => {
		const p = paint(tone);
		expect(ratio(colour(p.text, vars, panel), panel)).toBeGreaterThanOrEqual(MIN_TEXT);
		expect(ratio(colour(p.outline, vars, panel), panel)).toBeGreaterThanOrEqual(MIN_GRAPH);
	});
});
