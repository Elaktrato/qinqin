import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/themes/derive.json';
import { cssVariables, derive, withAlpha, TOKEN_NAMES } from './derive';
import type { Theme } from './types';

describe('docs/contracts/themes/derive.json', () => {
	it.each(fixture.alpha)('alpha $p% = $hex', ({ p, hex }) => {
		expect(withAlpha('#000000', p)).toBe(`#000000${hex}`);
	});

	it('has the cases', () => {
		expect(fixture.cases.length).toBeGreaterThanOrEqual(8);
	});

	it.each(fixture.cases)('$name', ({ theme, accent, expect: want }) => {
		expect(derive(theme as unknown as Theme, accent)).toEqual(want);
	});
});

describe('cssVariables', () => {
	const mocha = fixture.cases[0].theme as unknown as Theme;
	const vars = cssVariables(mocha, derive(mocha, 'mauve'));

	it('sets exactly the properties of the README table', () => {
		expect(Object.keys(vars).sort()).toEqual([...TOKEN_NAMES].sort());
		expect(TOKEN_NAMES).toHaveLength(29);
	});

	it('maps theme colours, grades and derived tokens', () => {
		expect(vars['--panel']).toBe('#1e1e2e');
		expect(vars['--grade-again']).toBe('#f38ba8');
		expect(vars['--accent']).toBe('#cba6f7');
		expect(vars['--on-accent']).toBe('#11111b');
		expect(vars['--hair']).toBe('#45475a8c');
		expect(vars['--accent-58']).toBe('#cba6f794');
		expect(vars['--mastery-0']).toBe('#45475a8c');
		expect(vars['--mastery-4']).toBe('#cba6f7ff');
		expect(vars['--highlight-wash']).toBe('#f9e2af3d');
		expect(vars['--reading-accent']).toBe('#cba6f7');
	});
});
