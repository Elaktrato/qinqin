import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/themes/contrast.json';
import { failing, luminance, ratio, review } from './contrast';
import type { Theme } from './types';

describe('docs/contracts/themes/contrast.json', () => {
	it('has pairs and checks', () => {
		expect(fixture.pairs.length).toBeGreaterThanOrEqual(10);
		expect(fixture.checks.length).toBeGreaterThanOrEqual(2);
	});

	it.each(fixture.pairs)('ratio($fg, $bg) = $ratio', ({ fg, bg, ratio: want }) => {
		expect(ratio(fg, bg)).toBe(want);
	});

	it.each(fixture.checks)('review of $name', ({ theme, expect: want, failing: n }) => {
		const got = review(theme as unknown as Theme);
		expect(got).toEqual(want);
		expect(failing(got)).toBe(n);
	});

	it('luminance spans 0..1', () => {
		expect(luminance('#000000')).toBe(0);
		expect(luminance('#ffffff')).toBeCloseTo(1, 12);
	});
});
