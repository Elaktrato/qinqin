import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/schemes', () => ({ getSchemeEntries: vi.fn() }));

import { getSchemeEntries } from '$lib/api/schemes';
import type { EntryBase, Scheme } from '$lib/api/types';
import { clearLevelItemsCache } from '$lib/features/flashcards/decks/systemDeckItems';
import { loadLevelKeys } from './levelKeys';

function word(id: number): EntryBase {
	return {
		id,
		language: 'zh',
		kind: 'word',
		written: `w${id}`,
		readings: [],
		attrs: {},
		radicalId: null
	};
}

const scheme: Scheme = {
	id: 4,
	name: 'HSK 3.0 (words)',
	unit: 'word',
	language: 'zh',
	packId: 'hsk-words',
	levels: [
		{ id: 2, name: 'HSK 2', ord: 2 },
		{ id: 1, name: 'HSK 1', ord: 1 }
	]
} as Scheme;

beforeEach(() => {
	clearLevelItemsCache();
	vi.mocked(getSchemeEntries).mockImplementation(async (_id, level) =>
		level === 'HSK 1' ? [word(1), word(2)] : [word(2), word(3)]
	);
});
afterEach(() => vi.clearAllMocks());

describe('loadLevelKeys', () => {
	it('keys an entry by the ord of its first level', async () => {
		const keyOf = await loadLevelKeys(scheme);
		expect(keyOf(1)).toBe(1);
		expect(keyOf(2)).toBe(1); // in HSK 1 and HSK 2: the first level wins
		expect(keyOf(3)).toBe(2);
		expect(keyOf(99)).toBeNull();
	});

	it('uses the cached level items', async () => {
		await loadLevelKeys(scheme);
		const before = vi.mocked(getSchemeEntries).mock.calls.length;
		await loadLevelKeys(scheme);
		expect(vi.mocked(getSchemeEntries).mock.calls.length).toBe(before);
	});
});
