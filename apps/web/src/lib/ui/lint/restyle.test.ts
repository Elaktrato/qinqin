import { describe, expect, it } from 'vitest';
import { restyleFindings } from './restyle';

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

	it('shadow flags a blurred shadow, not float/none/hairline insets', () => {
		expect(restyleFindings(css('.a{box-shadow:0 10px 30px rgba(0,0,0,.3)}'), 'svelte')[0].rule).toBe('shadow');
		expect(restyleFindings(css('.a{box-shadow:var(--shadow-float)}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{box-shadow:none}'), 'svelte')).toEqual([]);
		expect(restyleFindings(css('.a{box-shadow:inset 0 0 0 1px var(--line)}'), 'svelte')).toEqual([]);
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
