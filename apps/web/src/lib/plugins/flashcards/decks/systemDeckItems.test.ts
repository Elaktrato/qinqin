import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/api/schemes', () => ({ getSchemeEntries: vi.fn(), getSchemes: vi.fn() }));

import { getSchemeEntries } from '$lib/api/schemes';
import type { EntryBase } from '$lib/api/types';
import { clearLevelItemsCache, loadLevelItems } from './systemDeckItems';
import type { LevelDeck } from './systemDecks';

function deck(level: string, unit = 'word'): LevelDeck {
	return { kind: 'level', schemeId: 1, packId: 'p', schemeName: 'S', unit, level, ord: 1 };
}
function entry(id: number, kind = 'word'): EntryBase {
	return { id, language: 'zh', kind, written: `w${id}`, readings: [], attrs: {}, radicalId: null };
}

let pending: { level: string | undefined; resolve: (rows: EntryBase[]) => void; reject: (e: Error) => void }[];
beforeEach(() => {
	clearLevelItemsCache();
	pending = [];
	vi.mocked(getSchemeEntries).mockReset();
	vi.mocked(getSchemeEntries).mockImplementation(
		(_id, level) =>
			new Promise((resolve, reject) => {
				pending.push({ level, resolve, reject });
			})
	);
});

describe('loadLevelItems', () => {
	it('runs at most two requests at once and applies the unit filter', async () => {
		const results = ['A', 'B', 'C', 'D'].map((l) => loadLevelItems(deck(l)));
		await Promise.resolve();
		expect(pending.map((p) => p.level)).toEqual(['A', 'B']);
		pending[0].resolve([entry(1), entry(2, 'character')]);
		await vi.waitFor(() => expect(pending).toHaveLength(3));
		pending[1].resolve([entry(3)]);
		await vi.waitFor(() => expect(pending).toHaveLength(4));
		pending[2].resolve([]);
		pending[3].resolve([]);
		const [a] = await Promise.all(results);
		expect(a.map((e) => e.id)).toEqual([1]);
	});

	it('caches a loaded level and shares an in-flight request', async () => {
		const first = loadLevelItems(deck('A'));
		const second = loadLevelItems(deck('A'));
		await Promise.resolve();
		expect(pending).toHaveLength(1);
		pending[0].resolve([entry(1)]);
		await Promise.all([first, second]);
		await loadLevelItems(deck('A'));
		expect(getSchemeEntries).toHaveBeenCalledTimes(1);
	});

	it('never caches a failure', async () => {
		const failing = loadLevelItems(deck('A'));
		await Promise.resolve();
		pending[0].reject(new Error('offline'));
		await expect(failing).rejects.toThrow('offline');
		const retry = loadLevelItems(deck('A'));
		await Promise.resolve();
		expect(pending).toHaveLength(2);
		pending[1].resolve([entry(5)]);
		expect((await retry).map((e) => e.id)).toEqual([5]);
	});
});
