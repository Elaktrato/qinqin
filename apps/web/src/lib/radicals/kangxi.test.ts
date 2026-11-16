import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { radicalNumber, radicalTable, radicalStrokes, radicalChar } from './kangxi';

// The app imports a copy (the web build cannot reach docs/); it must stay
// byte-identical to the contract fixture.
describe('kangxi.json copy', () => {
	it('is identical to docs/contracts/radicals/kangxi.json', () => {
		const contract = readFileSync(resolve(__dirname, '../../../../../docs/contracts/radicals/kangxi.json'), 'utf8');
		const copy = readFileSync(resolve(__dirname, 'kangxi.json'), 'utf8');
		expect(copy).toBe(contract);
	});
});

describe('radicalTable', () => {
	it('groups 214 radicals into 17 stroke groups in number order', () => {
		const groups = radicalTable('ja');
		expect(groups.map((g) => g.s)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
		const all = groups.flatMap((g) => g.radicals.map((r) => r.n));
		expect(all).toEqual(Array.from({ length: 214 }, (_, i) => i + 1));
		expect(groups[3].radicals.find((r) => r.n === 85)).toEqual({ n: 85, c: '水', forms: ['氵', '氺'] });
	});

	it('shows the language forms: zh simplified, ja Japanese, by primary subtag', () => {
		const find = (lang: string, n: number) =>
			radicalTable(lang)
				.flatMap((g) => g.radicals)
				.find((r) => r.n === n);
		expect(find('zh', 149)?.forms).toEqual(['訁', '讠']);
		expect(find('zh-TW', 149)?.forms).toEqual(['訁', '讠']);
		expect(find('ja', 149)?.forms).toEqual(['訁']);
		expect(find('ja', 212)?.forms).toEqual(['竜']);
		expect(find('zh', 212)?.forms).toEqual(['龙']);
		expect(find('ko', 149)?.forms).toEqual(['訁']);
	});
});

describe('radicalNumber', () => {
	it('maps the character or any form to its number, 0 when none', () => {
		expect(radicalNumber('氵')).toBe(85);
		expect(radicalNumber('水')).toBe(85);
		expect(radicalNumber('讠')).toBe(149);
		expect(radicalNumber('竜')).toBe(212);
		expect(radicalNumber('月')).toBe(74);
		expect(radicalNumber('⺼')).toBe(130);
		expect(radicalNumber('阝')).toBe(163);
		expect(radicalNumber('語')).toBe(0);
		expect(radicalNumber('')).toBe(0);
	});

	it('knows strokes and characters', () => {
		expect(radicalStrokes(114)).toBe(5);
		expect(radicalStrokes(214)).toBe(17);
		expect(radicalStrokes(0)).toBe(0);
		expect(radicalChar(85)).toBe('水');
		expect(radicalChar(999)).toBe('');
	});
});
