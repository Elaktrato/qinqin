// The focus ring colour (docs/contracts/themes/README.md, `focusRing`) over every
// built-in theme and every accent it offers: at least 3:1 on every surface a
// focused control sits on (panel, raised, chrome).
import { describe, expect, it } from 'vitest';
import { MIN_GRAPH, ratio } from './contrast';
import { accentChoices, cssVariables, derive } from './derive';
import { BUILTIN_THEMES } from './testing/builtinThemes';

const cases = BUILTIN_THEMES.flatMap((theme) => accentChoices(theme).map((accent) => ({ id: `${theme.id}/${accent}`, theme, accent })));

describe.each(cases)('$id', ({ theme, accent }) => {
	const d = derive(theme, accent);

	it('the ring is at least 3:1 on panel, raised and chrome', () => {
		for (const s of ['panel', 'raised', 'chrome'] as const) {
			expect(ratio(d.focusRing, theme.colors[s]), s).toBeGreaterThanOrEqual(MIN_GRAPH);
		}
	});

	it('it is the accent whenever the accent reaches 3:1 on all three, else text', () => {
		const ok = (['panel', 'raised', 'chrome'] as const).every((s) => ratio(d.accent, theme.colors[s]) >= MIN_GRAPH);
		expect(d.focusRing).toBe(ok ? d.accent : theme.colors.text);
		expect(cssVariables(theme, d)['--focus-colour']).toBe(d.focusRing);
	});
});
