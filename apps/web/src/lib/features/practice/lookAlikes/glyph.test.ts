// The highlight of an answer (#228): the stroke data is used only when it has the set's stroke count.
import { describe, expect, it } from 'vitest';
import { strokesFor } from './glyph';

const data = (n: number) => ({ strokes: Array.from({ length: n }, (_, i) => `M ${i} 0 Z`), medians: Array.from({ length: n }, () => [[0, 0]]) });

describe('strokesFor', () => {
	it('gives each stroke outline and whether it is marked', () => {
		expect(strokesFor('未', data(3), 3, [0, 2])).toEqual([
			{ outline: 'M 0 0 Z', marked: true },
			{ outline: 'M 1 0 Z', marked: false },
			{ outline: 'M 2 0 Z', marked: true }
		]);
	});
	it('refuses data with another stroke count (another stroke order or shape), or unreadable data', () => {
		expect(strokesFor('象', data(11), 12, [])).toBeNull();
		expect(strokesFor('未', { strokes: [] }, 5, [])).toBeNull();
		expect(strokesFor('未', null, 5, [])).toBeNull();
	});
});

