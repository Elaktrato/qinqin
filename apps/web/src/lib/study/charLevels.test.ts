import { describe, expect, it } from 'vitest';
import type { CharRow, Scheme } from '$lib/api/types';
import {
	LEVEL_ALL,
	filterByLevel,
	levelGroupsFor,
	parseLevelValue,
	readLevelChoice,
	writeLevelChoice
} from './charLevels';

function scheme(over: Partial<Scheme> & Pick<Scheme, 'id' | 'name' | 'language'>): Scheme {
	return {
		unit: 'character',
		levels: [],
		...over
	};
}

const ja = [
	scheme({
		id: 2,
		name: 'JLPT kanji (approximate)',
		language: 'ja',
		packId: 'jlpt-kanji',
		levels: [
			{ id: 12, name: 'N5', ord: 0 },
			{ id: 13, name: 'N4', ord: 1 }
		]
	}),
	scheme({
		id: 4,
		name: 'Jōyō kanji by school grade',
		language: 'ja',
		packId: 'joyo-grades',
		levels: [{ id: 20, name: 'Grade 1', ord: 0 }]
	}),
	scheme({ id: 1, name: 'JLPT N5 mini (sample)', language: 'ja', packId: 'jlpt-mini', levels: [{ id: 3, name: 'N5', ord: 0 }] })
];

const zh = [
	scheme({
		id: 3,
		name: 'HSK 3.0 (characters)',
		language: 'zh',
		packId: 'hsk-chars',
		levels: [
			{ id: 30, name: 'HSK 1', ord: 0 },
			{ id: 31, name: 'HSK 2', ord: 1 }
		]
	}),
	scheme({
		id: 5,
		name: 'HSK 3.0 (words)',
		language: 'zh',
		packId: 'hsk-words',
		levels: [{ id: 40, name: 'HSK 1', ord: 0 }]
	}),
	scheme({ id: 6, name: 'HSK mini (sample)', language: 'zh', packId: 'hsk-mini', levels: [{ id: 1, name: '1', ord: 0 }] })
];

function memoryStorage(): Storage {
	const m = new Map<string, string>();
	return {
		get length() {
			return m.size;
		},
		clear: () => m.clear(),
		getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
		key: (i) => [...m.keys()][i] ?? null,
		removeItem: (k) => void m.delete(k),
		setItem: (k, v) => void m.set(k, String(v))
	};
}

describe('levelGroupsFor', () => {
	it('lists the real schemes of the language, in scheme order, without the samples', () => {
		expect(levelGroupsFor('ja', ja).map((g) => g.label)).toEqual([
			'JLPT kanji (approximate)',
			'Jōyō kanji by school grade'
		]);
		expect(levelGroupsFor('ja', ja)[0].options.map((o) => o.label)).toEqual(['N5', 'N4']);
		expect(levelGroupsFor('zh', zh).map((g) => g.label)).toEqual(['HSK 3.0 (characters)', 'HSK 3.0 (words)']);
	});

	it('tells schemes with the same name apart by pack id', () => {
		const twin = scheme({
			id: 9,
			name: 'HSK 3.0 (characters)',
			language: 'zh',
			packId: 'local-hsk',
			levels: [{ id: 90, name: 'HSK 1', ord: 0 }]
		});
		expect(levelGroupsFor('zh', [...zh, twin]).map((g) => g.label)).toEqual([
			'HSK 3.0 (characters) · hsk-chars',
			'HSK 3.0 (words)',
			'HSK 3.0 (characters) · local-hsk'
		]);
	});

	it('has no groups for a language not written with Han characters', () => {
		expect(levelGroupsFor('es', zh)).toEqual([]);
	});
});

describe('parseLevelValue', () => {
	it('round-trips a scheme and level id', () => {
		expect(parseLevelValue('12:13')).toEqual({ schemeId: 12, levelId: 13 });
		expect(parseLevelValue(LEVEL_ALL)).toBeNull();
		expect(parseLevelValue('nope')).toBeNull();
		expect(parseLevelValue('12:')).toBeNull();
		expect(parseLevelValue('0:1')).toBeNull();
	});
});

describe('readLevelChoice / writeLevelChoice', () => {
	const groups = levelGroupsFor('ja', ja);

	it('remembers a valid choice per workspace', () => {
		const s = memoryStorage();
		writeLevelChoice(s, 7, '2:13');
		expect(readLevelChoice(s, 7, groups)).toBe('2:13');
		expect(readLevelChoice(s, 8, groups)).toBe(LEVEL_ALL);
	});

	it('falls back to all levels for a missing, stale or unreadable value', () => {
		const s = memoryStorage();
		s.setItem('qinqin.map.level.7', '99:99');
		expect(readLevelChoice(s, 7, groups)).toBe(LEVEL_ALL);
		s.setItem('qinqin.map.level.7', 'garbage');
		expect(readLevelChoice(s, 7, groups)).toBe(LEVEL_ALL);
		expect(readLevelChoice(null, 7, groups)).toBe(LEVEL_ALL);
		expect(() =>
			readLevelChoice(
				{
					...memoryStorage(),
					getItem: () => {
						throw new Error('blocked');
					}
				},
				7,
				groups
			)
		).not.toThrow();
	});
});

describe('filterByLevel', () => {
	const level = { levelId: 12, name: 'N5', chars: new Set(['日', '本']) };
	const rows: CharRow[] = [
		{ i: 1, c: '日' },
		{ i: 2, c: '本' },
		{ i: 3, c: '語', v: ['語', '语'] },
		{ i: 4, c: '書', v: ['书'] },
		{ i: 5, c: '水' }
	];

	it('keeps the glyphs of the level and drops the rest', () => {
		expect(filterByLevel(rows, level).map((r) => r.c)).toEqual(['日', '本']);
	});

	it('keeps a cell whose variant form is in the level', () => {
		const traditional = { ...level, chars: new Set(['书']) };
		expect(filterByLevel(rows, traditional).map((r) => r.c)).toEqual(['書']);
	});
});
