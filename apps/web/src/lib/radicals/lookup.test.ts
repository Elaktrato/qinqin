import { describe, expect, it } from 'vitest';
import fixture from '../../../../../docs/contracts/radicals/lookup.json';
import type { CharRow } from '$lib/api/types';
import { buildIndex, lookup, pickerParts, MIN_PART_USE, RESULT_CAP, type Selection } from './lookup';

interface Case {
	name: string;
	selection: Selection;
	universe?: CharRow[];
	components?: Record<string, string[]>;
	want: {
		results: string[];
		total: number;
		groups: { s: number; count: number }[];
		availableParts: string[];
		availableStrokes: number[];
	};
}

describe('lookup (docs/contracts/radicals/lookup.json)', () => {
	it('uses the contract constants', () => {
		expect(MIN_PART_USE).toBe(fixture.minPartUse);
		expect(RESULT_CAP).toBe(fixture.cap);
	});

	it.each(fixture.cases as Case[])('$name', (c) => {
		const index = buildIndex(c.universe ?? (fixture.universe as CharRow[]), c.components ?? fixture.components);
		const got = lookup(index, c.selection, { cap: fixture.cap });
		expect(got.results.map((r) => r.c)).toEqual(c.want.results);
		expect(got.total).toBe(c.want.total);
		expect(got.groups.map((g) => ({ s: g.s, count: g.count }))).toEqual(c.want.groups);
		expect([...got.availableParts].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!)).toEqual(c.want.availableParts);
		expect(got.availableStrokes).toEqual(c.want.availableStrokes);
	});

	it('groups carry the capped result cells', () => {
		const index = buildIndex(fixture.universe as CharRow[], fixture.components);
		const got = lookup(index, { r: 85, p: [] });
		expect(got.groups.map((g) => g.cells.map((x) => x.c))).toEqual([['池'], ['河', '沽'], ['海'], ['㳄']]);
		expect(got.results[0]).toMatchObject({ i: 3, c: '池' });
	});
});

describe('pickerParts', () => {
	it.each(fixture.pickerCases)('$name', (c) => {
		expect(pickerParts(c.parts, new Set(c.available), c.showAll)).toEqual(c.want);
	});
});
