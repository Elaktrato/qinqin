import { describe, expect, it } from 'vitest';
import type { CharRow, Scheme } from '$lib/api/types';
import type { SchemeLevelMembers } from '$lib/studycore/charGroups';
import { readMasteryMap } from './mapGrading';
import { FOCUS_OUTSIDE, focusOptions, mapChars, outsideSectionLabel, readFocus, studyLevels, withOutsideLabel } from './mapView';

const HSK: Scheme = {
	id: 7,
	name: 'HSK 3.0 (characters)',
	unit: 'character',
	language: 'zh',
	packId: 'hsk-chars',
	levels: [
		{ id: 70, ord: 0, name: 'HSK 1' },
		{ id: 71, ord: 1, name: 'HSK 2' },
		{ id: 72, ord: 2, name: 'HSK 3' }
	]
};

const MEMBERS: SchemeLevelMembers[] = [
	{ levelId: 70, name: 'HSK 1', chars: new Set(['一', '二']) },
	{ levelId: 71, name: 'HSK 2', chars: new Set(['三', '二']) },
	{ levelId: 72, name: 'HSK 3', chars: new Set(['四']) }
];

const row = (i: number, c: string, v?: string[]): CharRow => ({ i, c, ...(v ? { v } : {}) });
// 五 is in no level; 亖 sits in HSK 3 through its variant 四.
const CHARS = [row(1, '一'), row(2, '二'), row(3, '三'), row(4, '亖', ['四']), row(5, '五')];
const glyphs = (rows: CharRow[]) => rows.map((r) => r.c);

describe('studyLevels', () => {
	it('every level of the pack in order, and the study set from the stored ords', () => {
		const stored = readMasteryMap({ masteryMap: { levels: { 'hsk-chars': [2, 0] } } });
		const { all, set } = studyLevels(HSK, MEMBERS, stored);
		expect(all.map((l) => [l.levelId, l.ord, l.name])).toEqual([
			[70, 0, 'HSK 1'],
			[71, 1, 'HSK 2'],
			[72, 2, 'HSK 3']
		]);
		expect(set.map((l) => l.name)).toEqual(['HSK 1', 'HSK 3']);
	});

	it('a level the characters answer lacks is left out; nothing stored is every level', () => {
		const { all, set } = studyLevels(HSK, MEMBERS.slice(0, 2), readMasteryMap({}));
		expect(all.map((l) => l.name)).toEqual(['HSK 1', 'HSK 2']);
		expect(set.map((l) => l.name)).toEqual(['HSK 1', 'HSK 2']);
	});
});

describe('mapChars', () => {
	const ids = (...levelIds: number[]) => new Set(levelIds);

	it('the study set first: only its levels, each character at its lowest level', () => {
		// 二 is HSK 1 (lowest level wins): with HSK 1 off it is not pulled into HSK 2.
		expect(glyphs(mapChars(CHARS, MEMBERS, ids(71, 72), false, 'all'))).toEqual(['三', '亖']);
		expect(glyphs(mapChars(CHARS, MEMBERS, ids(70, 71, 72), false, 'all'))).toEqual(['一', '二', '三', '亖']);
	});

	it('outside characters only when included', () => {
		expect(glyphs(mapChars(CHARS, MEMBERS, ids(70), true, 'all'))).toEqual(['一', '二', '五']);
	});

	it('then the Level focus narrows within the set', () => {
		expect(glyphs(mapChars(CHARS, MEMBERS, ids(70, 72), true, '7:72'))).toEqual(['亖']);
		expect(glyphs(mapChars(CHARS, MEMBERS, ids(70, 72), true, FOCUS_OUTSIDE))).toEqual(['五']);
		// A focus outside the set (a stale choice) shows nothing rather than leaving the set.
		expect(glyphs(mapChars(CHARS, MEMBERS, ids(70), false, '7:71'))).toEqual([]);
	});
});

describe('the Level focus', () => {
	const set = studyLevels(HSK, MEMBERS, readMasteryMap({ masteryMap: { levels: { 'hsk-chars': [0, 1] } } })).set;

	it('offers all study levels, each study level, and Outside while it is included', () => {
		expect(focusOptions(HSK.id, set, false, 'HSK 3.0 (characters)').map((o) => [o.value, o.label])).toEqual([
			['all', 'All study levels'],
			['7:70', 'HSK 1'],
			['7:71', 'HSK 2']
		]);
		expect(focusOptions(HSK.id, set, true, 'HSK 3.0 (characters)').at(-1)).toEqual({
			value: FOCUS_OUTSIDE,
			label: 'Outside HSK 3.0 (characters)'
		});
	});

	it('reads a remembered focus that is still offered, else all study levels', () => {
		const offered = focusOptions(HSK.id, set, false, 'HSK');
		const storage = { getItem: (key: string) => (key === 'qinqin.map.level.1' ? '7:71' : null) } as unknown as Storage;
		expect(readFocus(storage, 1, offered)).toBe('7:71');
		expect(readFocus(storage, 2, offered)).toBe('all');
		const stale = { getItem: () => '7:72' } as unknown as Storage;
		expect(readFocus(stale, 1, offered)).toBe('all');
		const broken = {
			getItem: () => {
				throw new Error('denied');
			}
		} as unknown as Storage;
		expect(readFocus(broken, 1, offered)).toBe('all');
	});
});

describe('the Outside section', () => {
	it('is named after the grading', () => {
		expect(outsideSectionLabel('HSK 3.0 (characters)')).toBe('Outside HSK 3.0 (characters)');
		const sections = [
			{ id: 'level-70', label: 'HSK 1', chars: [] },
			{ id: 'level-none', label: 'Not in this scheme', chars: [] }
		];
		expect(withOutsideLabel(sections, 'HSK').map((s) => s.label)).toEqual(['HSK 1', 'Outside HSK']);
	});
});
