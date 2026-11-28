import { describe, expect, it } from 'vitest';
import { parseTypeOrder, typeOrderChoices } from './typeOrderView';

describe('typeOrderView', () => {
	it('offers mixed first, then grouped by type', () => {
		expect(typeOrderChoices()).toEqual([
			{ value: 'mixed', label: 'Mixed' },
			{ value: 'grouped', label: 'Grouped by type' }
		]);
	});

	it('reads a select value, unknown as mixed', () => {
		expect(parseTypeOrder('grouped')).toBe('grouped');
		expect(parseTypeOrder('mixed')).toBe('mixed');
		expect(parseTypeOrder('random')).toBe('mixed');
		expect(parseTypeOrder('')).toBe('mixed');
	});
});
