import { describe, expect, it } from 'vitest';
import { declarations, newMarks, nonEmptyLevels, rangeEntries, scopeLabel, type LevelMembers } from './declare';

const levels: LevelMembers[] = [
	{ id: 1, name: 'HSK 1', entryIds: [1, 2, 3] },
	{ id: 2, name: 'HSK 2', entryIds: [3, 4] },
	{ id: 3, name: 'HSK 3', entryIds: [] },
	{ id: 4, name: 'HSK 4', entryIds: [5] }
];

describe('rangeEntries', () => {
	it('is every entry of the levels up to and including the chosen one, once, in level order', () => {
		expect(rangeEntries(levels, 2)).toEqual([1, 2, 3, 4]);
		expect(rangeEntries(levels, 1)).toEqual([1, 2, 3]);
		expect(rangeEntries(levels, 4)).toEqual([1, 2, 3, 4, 5]);
	});

	it('is empty for no level', () => {
		expect(rangeEntries(levels, 0)).toEqual([]);
		expect(rangeEntries([], 3)).toEqual([]);
	});
});

describe('nonEmptyLevels', () => {
	it('drops levels without entries and keeps the order', () => {
		expect(nonEmptyLevels(levels).map((l) => l.id)).toEqual([1, 2, 4]);
	});
});

describe('newMarks', () => {
	it('skips entries that are already marked', () => {
		expect(newMarks([1, 2, 3, 4], new Set([2, 4]))).toEqual([1, 3]);
	});
	it('is empty when everything is marked', () => {
		expect(newMarks([1], new Set([1]))).toEqual([]);
	});
});

describe('declarations', () => {
	const batchA = { id: 'A', source: 'range' as const, scope: 'HSK · HSK 2' };
	const batchB = { id: 'B', source: 'placement' as const, scope: 'HSK · HSK 4' };

	it('groups live marks by batch, newest first', () => {
		const list = declarations([
			{ entryId: 1, createdAt: '2026-11-26T10:00:00.000Z', batch: batchA },
			{ entryId: 2, createdAt: '2026-11-26T10:00:00.000Z', batch: batchA },
			{ entryId: 9, createdAt: '2026-11-27T10:00:00.000Z', batch: batchB }
		]);
		expect(list).toEqual([
			{ id: 'B', source: 'placement', scope: 'HSK · HSK 4', createdAt: '2026-11-27T10:00:00.000Z', entryIds: [9] },
			{ id: 'A', source: 'range', scope: 'HSK · HSK 2', createdAt: '2026-11-26T10:00:00.000Z', entryIds: [1, 2] }
		]);
	});

	it('is empty without declared marks', () => {
		expect(declarations([])).toEqual([]);
	});
});

describe('scopeLabel', () => {
	it('names the scheme and the level', () => {
		expect(scopeLabel('HSK', 'HSK 3')).toBe('HSK · HSK 3');
	});
});
