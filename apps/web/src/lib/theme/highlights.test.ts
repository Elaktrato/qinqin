// The reader's highlight colours (docs/contracts/themes/README.md, `highlights`)
// over every built-in theme and every accent it offers: four distinct colours,
// each showing the hue its name says, whatever the accent.
import { describe, expect, it } from 'vitest';
import { ratio } from './contrast';
import { accentChoices, cssVariables, derive, withAlpha } from './derive';
import { BUILTIN_THEMES, hueOf, over } from './testing/builtinThemes';

const NAMED_HUE = { green: 135, blue: 225, pink: 330 } as const;
const circular = (a: number, b: number): number => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe.each(BUILTIN_THEMES.map((t) => [t.id, t] as const))('%s', (_id, theme) => {
	it.each(accentChoices(theme))('with %s: four distinct colours, named by their hue', (accent) => {
		const d = derive(theme, accent);
		const h = d.highlights;
		expect(new Set([h.yellow, h.green, h.blue, h.pink]).size).toBe(4);
		expect(h).toEqual(derive(theme, null).highlights);
		expect(h.yellow).toBe(theme.colors.warn);
		for (const [name, want] of Object.entries(NAMED_HUE)) {
			expect(circular(hueOf(h[name as keyof typeof NAMED_HUE]), want), name).toBeLessThan(2);
		}
		// The washes the reader draws under text stay apart from the selected word's.
		for (const c of [h.green, h.blue, h.pink]) expect(withAlpha(c, 24)).not.toBe(d.selectedWash);
	});

	it('text stays readable on every highlight wash (at least 3:1; the yellow wash sets the floor)', () => {
		const d = derive(theme, null);
		const yellow = ratio(theme.colors.text, over(d.highlightWash, theme.colors.panel));
		for (const c of Object.values(d.highlights)) {
			const r = ratio(theme.colors.text, over(withAlpha(c, 24), theme.colors.panel));
			expect(r, c).toBeGreaterThanOrEqual(Math.min(3, yellow));
		}
	});

	it('paints them as --highlight-*', () => {
		const d = derive(theme, null);
		const v = cssVariables(theme, d);
		expect([v['--highlight-yellow'], v['--highlight-green'], v['--highlight-blue'], v['--highlight-pink']]).toEqual([
			d.highlights.yellow,
			d.highlights.green,
			d.highlights.blue,
			d.highlights.pink
		]);
	});
});
