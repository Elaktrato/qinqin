import { describe, expect, it } from 'vitest';
import { stalePending, restyleFindings } from './restyle';

const css = (body: string): string => `<style>${body}</style>`;

describe('restyle rules (#106)', () => {
	it('weight flags 650, 700, bold and bolder, not 600 or a token', () => {
		expect(restyleFindings(css('.a{font-weight:650}'), 'svelte').map((f) => f.rule)).toEqual(['weight']);
		expect(restyleFindings(css('.a{font-weight:700}'), 'svelte')).toHaveLength(1);
		expect(restyleFindings(css('.a{font-weight:bold}'), 'svelte')).toHaveLength(1);
		expect(restyleFindings(css('.a{font-weight:bolder}'), 'svelte')).toHaveLength(1);
		expect(restyleFindings(css('.a{font-weight:600}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{font-weight:var(--weight-strong)}'), 'svelte')).toEqual([]);
	});

	it('caps flags uppercase, capitalize and small-caps', () => {
		for (const v of ['uppercase', 'capitalize']) {
			expect(restyleFindings(css(`.a{text-transform:${v}}`), 'svelte')[0].rule).toBe('caps');
		}
		expect(restyleFindings(css('.a{font-variant:small-caps}'), 'svelte')[0].rule).toBe('caps');
	});

	it('border flags 2px in a plain rule, not focus/selected states or 1px', () => {
		expect(restyleFindings(css('.a{border:2px solid var(--line)}'), 'svelte')[0].rule).toBe('border');
		expect(restyleFindings(css('.a:focus-visible{border:2px solid currentColor}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a[aria-current="page"]{border:2px solid currentColor}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{border-bottom:1px solid var(--hair)}'), 'svelte')).toEqual([]);
	});

	it('border exempts the semantic 3px inline-start bar and forced-colour state borders', () => {
		// The error / caution bar is the non-colour cue, not a box (#106).
		expect(restyleFindings(css('.error{border-inline-start:3px solid var(--bad)}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.caution{border-inline-start:3px solid var(--warn)}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{border:3px solid var(--bad)}'), 'svelte')).toHaveLength(1);
		// Forced colours turn a state fill into a system-colour border.
		expect(restyleFindings(css('.a{border:2px solid Highlight}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{border-bottom:2px solid transparent}'), 'svelte')).toHaveLength(1);
	});

	it('shadow flags a blurred shadow, not float/none/hairline insets', () => {
		expect(restyleFindings(css('.a{box-shadow:0 10px 30px rgba(0,0,0,.3)}'), 'svelte')[0].rule).toBe('shadow');
		expect(restyleFindings(css('.a{box-shadow:var(--shadow-float)}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{box-shadow:none}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{box-shadow:inset 0 0 0 1px var(--line)}'), 'svelte')).toEqual([]);
		// Field's focus underline is a 1px accent line under the border, not a floating shadow.
		expect(restyleFindings(css('.a{box-shadow:0 1px 0 0 var(--accent)}'), 'svelte')).toEqual([]);
		// A vertical hairline between regions and a tab's inset underline are not floating shadows.
		expect(restyleFindings(css('.a{box-shadow:inset 1px 0 0 var(--hair)}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{box-shadow:inset 0 -1.5px 0 var(--accent)}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{box-shadow:inset 0 -2px 0 var(--accent)}'), 'svelte')).toEqual([]);
	});

	it('stalePending names a clean file still listed, and nothing that still has a finding', () => {
		// A listed file with no findings must fail the ratchet ("clean now: remove it").
		expect(stalePending(['routes/login/+page.svelte'], ['routes/settings/+page.svelte'])).toEqual([
			'routes/login/+page.svelte'
		]);
		expect(stalePending(['a', 'b'], ['b', 'c'])).toEqual(['a']);
		expect(stalePending([], [])).toEqual([]);
	});

	it('control flags raw text controls, not checkboxes or the OTP input', () => {
		expect(restyleFindings('<button>Go</button>', 'svelte')[0].rule).toBe('control');
		expect(restyleFindings('<select></select>', 'svelte')[0].rule).toBe('control');
		expect(restyleFindings('<input type="text" />', 'svelte')[0].rule).toBe('control');
		expect(restyleFindings('<input />', 'svelte')[0].rule).toBe('control');
		expect(restyleFindings('<input type="checkbox" />', 'svelte')).toEqual([]);
		expect(restyleFindings('<input autocomplete="one-time-code" />', 'svelte')).toEqual([]);
	});
});
