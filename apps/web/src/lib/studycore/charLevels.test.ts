import { describe, expect, it } from 'vitest';
import type { CharRow } from '$lib/api/types';
import { LEVEL_ALL, levelOf, parseLevelValue } from './charLevels';

describe('parseLevelValue', () => {
	it('round-trips a scheme and level id', () => {
		expect(parseLevelValue('12:13')).toEqual({ schemeId: 12, levelId: 13 });
		expect(parseLevelValue(LEVEL_ALL)).toBeNull();
		expect(parseLevelValue('nope')).toBeNull();
		expect(parseLevelValue('12:')).toBeNull();
		expect(parseLevelValue('0:1')).toBeNull();
	});
});

describe('levelOf', () => {
	const n5 = { levelId: 12, name: 'N5', chars: new Set(['日', '本']) };
	const n4 = { levelId: 13, name: 'N4', chars: new Set(['書', '语']) };
	const levels = [n5, n4];
	const rows: CharRow[] = [
		{ i: 1, c: '日' },
		{ i: 2, c: '本' },
		{ i: 3, c: '語', v: ['语'] },
		{ i: 4, c: '書', v: ['书'] },
		{ i: 5, c: '水' }
	];

	const filterByLevel = (list: CharRow[], members: typeof levels, id: number) => list.filter((r) => levelOf(r, members)?.levelId === id);

	it('keeps the glyphs the scheme grouping assigns to the level', () => {
		expect(filterByLevel(rows, levels, 12).map((r) => r.c)).toEqual(['日', '本']);
		expect(filterByLevel(rows, levels, 13).map((r) => r.c)).toEqual(['語', '書']);
	});

	it('uses the own glyph before a variant, the scheme grouping\'s rule', () => {
		expect(levelOf(rows[2], levels)?.levelId).toBe(13); // 語 is not in N5; 语 is in N4
		expect(levelOf(rows[0], levels)?.levelId).toBe(12);
		expect(levelOf(rows[4], levels)).toBeNull();
	});

	it('does not pull a cell into a level that only holds a variant when its own glyph is in another level', () => {
		const own = { levelId: 12, name: 'N5', chars: new Set(['書']) };
		const variant = { levelId: 13, name: 'N4', chars: new Set(['书']) };
		expect(filterByLevel(rows, [own, variant], 12).map((r) => r.c)).toEqual(['書']);
		expect(filterByLevel(rows, [own, variant], 13)).toEqual([]);
	});
});
