// Button text contrast in every state over every built-in theme and every accent
// it offers (the TS derivation, docs/contracts/themes/README.md). STATES mirrors
// the cascade of Button.svelte's <style>; the first test pins it to the source,
// the second measures it. Buttons sit on `panel` (transparent backgrounds show it).
import { describe, expect, it } from 'vitest';
import source from './Button.svelte?raw';
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

type Paint = { fg: string; bg: string };
/** color and background after applying `selectors` in cascade order. */
function paint(selectors: string[]): Paint {
	const p: Paint = { fg: '', bg: '' };
	for (const s of selectors) {
		const d = decls(s);
		if (d.color) p.fg = d.color;
		if (d.background) p.bg = d.background;
	}
	return p;
}

const HOVER = '.button:hover:not(:disabled)';
const STATES: { state: string; selectors: string[] }[] = [
	{ state: 'secondary', selectors: ['.button', '.secondary'] },
	{ state: 'secondary hover', selectors: ['.button', HOVER, '.secondary', '.secondary:hover:not(:disabled)'] },
	{ state: 'primary', selectors: ['.button', '.primary'] },
	{ state: 'primary hover', selectors: ['.button', HOVER, '.primary'] },
	{ state: 'plain', selectors: ['.button', '.plain'] },
	{ state: 'plain hover', selectors: ['.button', HOVER, '.plain'] },
	{ state: 'filled', selectors: ['.button', '.filled'] },
	{ state: 'filled hover', selectors: ['.button', HOVER, '.filled'] },
	{ state: 'danger', selectors: ['.button', '.secondary', '.danger', '.secondary.danger'] },
	{
		state: 'danger hover',
		selectors: ['.button', HOVER, '.secondary', '.secondary:hover:not(:disabled)', '.danger', '.secondary.danger']
	},
	{ state: 'plain danger', selectors: ['.button', '.plain', '.danger'] },
	{ state: 'disabled', selectors: ['.button', '.secondary', '.button:disabled'] }
];

/**
 * Filled (a rare variant no screen uses yet) puts --on-accent on the accent: the contract guarantees 4.5:1
 * for the default accent only (README, Contrast). These offered accents stay below it; a new one fails.
 */
/**
 * Solarized Light's own `text` is 4.99:1 on its panel (the contract asks 4.5), so no tint fits under it: the
 * primary wash of these accents leaves it at 4.15-4.27. Theme data, not the Button; a new one fails.
 */
const PRIMARY_BELOW: readonly string[] = [
	'solarized-light/blue',
	'solarized-light/magenta',
	'solarized-light/orange',
	'solarized-light/red',
	'solarized-light/violet'
];

const FILLED_BELOW: readonly string[] = [
	'catppuccin-latte/teal',
	'nord/sea',
	'rose-pine-dawn/foam',
	'rose-pine-dawn/iris',
	'rose-pine-dawn/love',
	'rose-pine-moon/pine',
	'solarized-dark/blue',
	'solarized-dark/cyan',
	'solarized-dark/green',
	'solarized-dark/violet',
	'solarized-dark/yellow',
	'solarized-light/blue',
	'solarized-light/violet'
];

function colour(value: string, vars: Record<TokenName, string>, panel: string): string {
	if (value === 'transparent') return panel;
	const m = /^var\((--[a-z0-9-]+)\)$/.exec(value);
	expect(m, `a token, not ${value}`).not.toBeNull();
	const v = vars[m![1] as TokenName];
	expect(v, m![1]).toBeTruthy();
	return over(v, panel);
}

describe('Button state paint (pinned to the source)', () => {
	it.each(STATES)('$state', ({ selectors }) => {
		const p = paint(selectors);
		expect(p.fg).toMatch(/^var\(--/);
		expect(p.bg).toMatch(/^(var\(--|transparent$)/);
	});

	it('hover changes neither text colour nor background (an underline and, for secondary, a stronger outline)', () => {
		const hovers = [...css.matchAll(/\n\t([^\n{]*:hover[^\n{]*) \{/g)].map((m) => m[1]);
		expect(hovers.sort()).toEqual(['.button:hover:not(:disabled)', '.secondary:hover:not(:disabled)']);
		expect(decls(HOVER)['text-decoration']).toBe('underline');
		for (const s of hovers) {
			expect(decls(s).color, s).toBeUndefined();
			expect(decls(s).background, s).toBeUndefined();
		}
	});
});

it('the filled exceptions are offered accents of built-in themes, never a default accent', () => {
	for (const id of FILLED_BELOW) {
		const [themeId, accent] = id.split('/');
		const theme = BUILTIN_THEMES.find((t) => t.id === themeId)!;
		expect(accentChoices(theme)).toContain(accent);
		expect(theme.defaultAccent).not.toBe(accent);
	}
	for (const id of PRIMARY_BELOW) expect(id.startsWith('solarized-light/')).toBe(true);
});

const cases = BUILTIN_THEMES.flatMap((theme) => accentChoices(theme).map((accent) => ({ id: `${theme.id}/${accent}`, theme, accent })));

describe.each(cases)('$id', ({ theme, accent }) => {
	const vars = cssVariables(theme, derive(theme, accent));
	const panel = theme.colors.panel;

	it.each(STATES)('$state text is at least 4.5:1', ({ state, selectors }) => {
		const p = paint(selectors);
		const r = ratio(colour(p.fg, vars, panel), colour(p.bg, vars, panel));
		const id = `${theme.id}/${accent}`;
		const known =
			(state.startsWith('filled') && FILLED_BELOW.includes(id)) || (state.startsWith('primary') && PRIMARY_BELOW.includes(id));
		if (known) expect(r).toBeLessThan(MIN_TEXT);
		else expect(r).toBeGreaterThanOrEqual(MIN_TEXT);
	});

	it('the focus ring is at least 3:1 on panel', () => {
		expect(ratio(vars['--focus-colour'], panel)).toBeGreaterThanOrEqual(MIN_GRAPH);
	});
});
