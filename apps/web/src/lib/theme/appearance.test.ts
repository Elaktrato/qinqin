import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/themes/appearance.json';
import {
	ADJUSTMENTS,
	APPEARANCE_KEY,
	DEFAULT_APPEARANCE,
	parseAppearance,
	resolveAppearance,
	writeAppearance,
	type AppearanceChange
} from './appearance';

describe('docs/contracts/themes/appearance.json', () => {
	it('names the row', () => {
		expect(APPEARANCE_KEY).toBe(fixture.key);
	});

	it('has the defaults and adjustments', () => {
		const { version, ...rest } = fixture.defaults;
		expect(version).toBe(1);
		expect(DEFAULT_APPEARANCE).toEqual(rest);
		expect(ADJUSTMENTS).toEqual(fixture.adjustments);
	});

	it('parses the example row', () => {
		const { version: _v, ...rest } = fixture.row;
		expect(parseAppearance(fixture.row)).toEqual(rest);
	});

	it.each(fixture.parse)('parse: $name', ({ value, expect: want }) => {
		expect(parseAppearance(value)).toEqual(want);
	});

	it.each(fixture.resolve)('resolve: $name', ({ value, prefersDark, expect: want }) => {
		expect(resolveAppearance(parseAppearance(value), fixture.themes, prefersDark)).toEqual(want);
	});

	it.each(fixture.write)('write: $name', ({ stored, change, expect: want }) => {
		expect(writeAppearance(stored, change as AppearanceChange)).toEqual(want);
	});

	it('never changes the stored value it is given', () => {
		const stored = structuredClone(fixture.row);
		writeAppearance(stored, { dark: { theme: 'catppuccin-mocha' } });
		expect(stored).toEqual(fixture.row);
	});

	it('falls back to the first theme of the scheme when even the default theme is missing', () => {
		const themes = [{ id: 'nord', scheme: 'dark', defaultAccent: 'frost', accentChoices: ['frost'] }];
		expect(resolveAppearance(parseAppearance(null), themes, true)).toEqual({
			slot: 'dark',
			theme: 'nord',
			accent: 'frost'
		});
	});
});
