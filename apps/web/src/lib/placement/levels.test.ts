import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scheme } from '$lib/api/types';
import { LevelItemsCache } from '$lib/context/caches';

vi.mock('$lib/api/schemes', () => ({ getSchemeEntries: vi.fn() }));
import { getSchemeEntries } from '$lib/api/schemes';
import { declarableSchemes, loadSchemeLevels } from './levels';

const entry = (id: number, kind = 'word') => ({
	id,
	language: 'zh',
	kind,
	written: `w${id}`,
	readings: [],
	attrs: {},
	radicalId: null
});

const hsk: Scheme = {
	id: 1,
	name: 'HSK',
	unit: 'word',
	language: 'zh',
	packId: 'hsk-words',
	levels: [
		{ id: 11, ord: 2, name: 'HSK 2' },
		{ id: 10, ord: 1, name: 'HSK 1' }
	]
};

beforeEach(() => vi.clearAllMocks());

describe('loadSchemeLevels', () => {
	it('lists the levels in level order with their words and indexes the entries', async () => {
		vi.mocked(getSchemeEntries).mockImplementation(async (_id, level) =>
			level === 'HSK 1' ? [entry(1), entry(2), entry(2), entry(9, 'character')] : [entry(3)]
		);
		const { levels, entries } = await loadSchemeLevels(new LevelItemsCache(), hsk);
		expect(levels).toEqual([
			{ id: 1, name: 'HSK 1', entryIds: [1, 2] },
			{ id: 2, name: 'HSK 2', entryIds: [3] }
		]);
		expect(entries.get(3)?.written).toBe('w3');
		expect(entries.has(9)).toBe(false);
	});

	it('a character scheme yields characters', async () => {
		vi.mocked(getSchemeEntries).mockResolvedValue([entry(1), entry(5, 'character')]);
		const kanji: Scheme = { ...hsk, unit: 'character', levels: [{ id: 1, ord: 1, name: 'N5' }] };
		const { levels } = await loadSchemeLevels(new LevelItemsCache(), kanji);
		expect(levels[0].entryIds).toEqual([5]);
	});

	it('rejects when a level fails', async () => {
		vi.mocked(getSchemeEntries).mockRejectedValue(new Error('offline'));
		await expect(loadSchemeLevels(new LevelItemsCache(), hsk)).rejects.toThrow('offline');
	});
});

describe('declarableSchemes', () => {
	it('keeps real schemes of the language and drops samples, other languages and empty schemes', () => {
		const sample: Scheme = { ...hsk, id: 2, packId: 'hsk-mini' };
		const ja: Scheme = { ...hsk, id: 3, language: 'ja', packId: 'jlpt' };
		const empty: Scheme = { ...hsk, id: 4, levels: [] };
		expect(declarableSchemes('zh-Hans', [hsk, sample, ja, empty]).map((s) => s.id)).toEqual([1]);
	});
});
