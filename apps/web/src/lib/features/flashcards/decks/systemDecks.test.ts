import { describe, expect, it } from 'vitest';

import fixture from '../../../../../../../docs/contracts/decks/system-deck-ids.json';
import type { EntryBase, Scheme } from '$lib/api/types';
import {
	copiedFrom,
	fnv1a32,
	levelDecks,
	levelItems,
	ownedLevelDeckId,
	ownedPluginDeckId,
	slugId
} from './systemDecks';
import { pluginDeckProviders } from './providers';

interface Case {
	kind: 'level' | 'plugin';
	packId?: string;
	level?: string;
	pluginId?: string;
	key?: string;
	fnv1a32: string;
	id: string;
}

describe('system deck ids contract', () => {
	it('hashes the empty string to the FNV offset basis', () => {
		expect(fnv1a32('')).toBe(fixture.fnv1a32Empty);
		expect(fnv1a32('')).toBe('811c9dc5');
	});

	for (const c of fixture.cases as Case[]) {
		it(`${c.kind} ${c.packId ?? c.pluginId} / ${c.level ?? c.key}`, () => {
			if (c.kind === 'level') {
				expect(fnv1a32(`${c.packId}\u0000${c.level}`)).toBe(c.fnv1a32);
				expect(ownedLevelDeckId(c.packId!, c.level!)).toBe(c.id);
			} else {
				expect(fnv1a32(`${c.pluginId}\u0000${c.key}`)).toBe(c.fnv1a32);
				expect(ownedPluginDeckId(c.pluginId!, c.key!)).toBe(c.id);
			}
		});
	}

	it('the plan example', () => {
		expect(ownedLevelDeckId('hsk-words', 'HSK 1')).toBe('d-lvl-hsk-words-b06fd2ac');
	});

	it('hashes NFC text: a decomposed level name gives the same id', () => {
		expect(ownedLevelDeckId('p', 'Ü')).toBe(ownedLevelDeckId('p', 'U\u0308'));
		expect(fnv1a32('é')).toBe(fnv1a32('é'));
	});

	it('slugs to lower case ascii and dashes', () => {
		expect(slugId('My Pack_2')).toBe('my-pack-2');
		expect(slugId('hsk-words')).toBe('hsk-words');
	});
});

function scheme(over: Partial<Scheme> & Pick<Scheme, 'id' | 'language'>): Scheme {
	return {
		name: `Scheme ${over.id}`,
		unit: 'word',
		packId: `pack-${over.id}`,
		levels: [],
		...over
	};
}
function entry(id: number, kind: string): EntryBase {
	return { id, language: 'zh', kind, written: `w${id}`, readings: [], attrs: {}, radicalId: null };
}

describe('levelDecks', () => {
	const schemes: Scheme[] = [
		scheme({
			id: 1,
			language: 'zh',
			name: 'HSK words',
			packId: 'hsk-words',
			levels: [
				{ id: 12, ord: 2, name: 'HSK 2' },
				{ id: 11, ord: 1, name: 'HSK 1' }
			]
		}),
		scheme({ id: 2, language: 'ja', name: 'JLPT kanji', unit: 'character', levels: [{ id: 21, ord: 1, name: 'N5' }] }),
		scheme({ id: 3, language: 'zh', name: 'TGH', unit: 'character', packId: 'tgh-chars', levels: [{ id: 31, ord: 1, name: 'Level 1' }] })
	];

	it('keeps the workspace language, in scheme order and level order', () => {
		const decks = levelDecks(schemes, 'zh');
		expect(decks.map((d) => [d.schemeId, d.level, d.ord])).toEqual([
			[1, 'HSK 1', 1],
			[1, 'HSK 2', 2],
			[3, 'Level 1', 1]
		]);
		expect(decks[0]).toMatchObject({ kind: 'level', packId: 'hsk-words', schemeName: 'HSK words', unit: 'word' });
		expect(levelDecks(schemes, 'ja')).toHaveLength(1);
		expect(levelDecks(schemes, 'ko')).toEqual([]);
	});

	it('falls back to a scheme id based pack id when the server sent none', () => {
		const [deck] = levelDecks([scheme({ id: 9, language: 'zh', packId: undefined, levels: [{ id: 1, ord: 1, name: 'A' }] })], 'zh');
		expect(deck.packId).toBe('scheme-9');
	});
});

describe('levelItems', () => {
	const entries = [entry(1, 'word'), entry(2, 'character'), entry(3, 'word'), entry(1, 'word'), entry(4, 'character')];
	const deck = (unit: string) => ({ kind: 'level' as const, schemeId: 1, packId: 'p', schemeName: 'S', unit, level: 'L', ord: 1 });

	it('a word scheme keeps words only, once each', () => {
		expect(levelItems(deck('word'), entries).map((e) => e.id)).toEqual([1, 3]);
	});
	it('a character scheme keeps characters only', () => {
		expect(levelItems(deck('character'), entries).map((e) => e.id)).toEqual([2, 4]);
	});
});

describe('plugin deck providers', () => {
	it('none ships one in v0.3.0', () => {
		expect(pluginDeckProviders).toEqual([]);
	});
});

describe('copiedFrom', () => {
	it('names the system deck a copy came from', () => {
		expect(copiedFrom({ type: 'level', packId: 'hsk-words', level: 'HSK 1' })).toBe('hsk-words · HSK 1');
		expect(copiedFrom({ type: 'plugin', pluginId: 'p', key: 'k' })).toBe('p · k');
		expect(copiedFrom({ type: 'frequency', packId: 'jiten-frequency', size: 500 })).toBe('jiten-frequency · Top 500');
	});
});
