import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../docs/contracts/frequency/starter-deck-ids.json';
import resolution from '../../../../../../../docs/contracts/frequency/starter-resolution.json';
import type { FrequencyPack } from '$lib/api/types';
import { ownedStarterDeckId } from './systemDecks';
import {
	STARTER_SIZES,
	starterAddedText,
	starterView,
	duplicateGlosses,
	starterAddItems,
	starterCredit,
	starterDeckName,
	starterDecks,
	starterTarget
} from './starterDecks';

const pack = (
	id: number,
	packId: string,
	language: string,
	name = `Pack ${packId}`
): FrequencyPack => ({
	id,
	packId,
	name,
	version: '1',
	language,
	license: 'CC BY-SA 4.0',
	attribution: 'test'
});

describe('ownedStarterDeckId (frequency/starter-deck-ids.json)', () => {
	it.each(fixture.cases)('$packId $size', (c) => {
		expect(ownedStarterDeckId(c.packId, c.size)).toBe(c.id);
	});
});

describe('starterDecks', () => {
	it('three sizes per pack of the workspace language, in pack priority order', () => {
		const decks = starterDecks(
			[pack(1, 'jiten-frequency', 'ja'), pack(2, 'local-zh', 'zh'), pack(3, 'other-ja', 'ja')],
			'ja'
		);
		expect(STARTER_SIZES).toEqual([500, 1000, 2000]);
		expect(decks.map((d) => `${d.packId}/${d.size}`)).toEqual([
			'jiten-frequency/500',
			'jiten-frequency/1000',
			'jiten-frequency/2000',
			'other-ja/500',
			'other-ja/1000',
			'other-ja/2000'
		]);
		expect(decks[0]).toEqual({
			kind: 'frequency',
			packNumId: 1,
			packId: 'jiten-frequency',
			packName: 'Pack jiten-frequency',
			license: 'CC BY-SA 4.0',
			attribution: 'test',
			size: 500
		});
		expect(starterDecks([pack(2, 'local-zh', 'zh')], 'ja')).toEqual([]);
	});

	it('names, credit line, target and items', () => {
		const [deck] = starterDecks([pack(1, 'jiten-frequency', 'ja', 'Jiten frequency list')], 'ja');
		expect(starterDeckName(deck)).toBe('Jiten frequency list · Top 500');
		expect(starterCredit(deck)).toBe('From Jiten frequency list · CC BY-SA 4.0');
		expect(starterTarget(deck)).toEqual({
			id: 'd-frq-jiten-frequency-d4514a31',
			name: 'Jiten frequency list · Top 500',
			source: { type: 'frequency', packId: 'jiten-frequency', size: 500 }
		});
		expect(
			starterAddItems([
				{
					id: 7,
					language: 'ja',
					kind: 'word',
					written: 'する',
					readings: [],
					attrs: {},
					radicalId: null,
					rank: 1
				}
			])
		).toEqual([{ entryId: 7, written: 'する' }]);
	});

	it('snapshots the served written form (frequency/starter-resolution.json)', () => {
		// The server serves each word in its display form with the row as list
		// form (の, not the search-only 乃); the add snapshots exactly that.
		const served = resolution.cases.flatMap((c) => c.expected);
		const entries = served.map((e, i) => ({
			id: i + 1,
			language: 'ja',
			kind: 'word',
			written: e.written,
			readings: [],
			attrs: {},
			radicalId: null,
			rank: e.rank
		}));
		expect(starterAddItems(entries).map((item) => item.written)).toEqual(
			served.map((e) => e.written)
		);
		expect(served.map((e) => e.written)).toContain('の');
	});
});

describe('starterView', () => {
	const entries = [1, 2, 3, 4].map((id) => ({
		id,
		language: 'ja',
		kind: 'word',
		written: `w${id}`,
		readings: [],
		attrs: {},
		radicalId: null,
		rank: id
	}));
	it('hides the known words and counts them', () => {
		const view = starterView(entries, new Set([2, 4, 99]));
		expect(view.shown.map((e) => e.id)).toEqual([1, 3]);
		expect(view.known).toBe(2);
		expect(view.knownLine).toBe('2 known words skipped');
		expect(starterView(entries, new Set([1])).knownLine).toBe('1 known word skipped');
		expect(starterView(entries, new Set()).knownLine).toBeNull();
	});
});

describe('starterAddedText', () => {
	const plan = (created: number, joined: number, known: number) => ({
		deck: null,
		writes: [],
		created,
		joined,
		skipped: 0,
		known
	});
	it('names the added words and the known ones skipped', () => {
		expect(starterAddedText(plan(3, 0, 1))).toBe('Added 3 words; 1 you know was skipped');
		expect(starterAddedText(plan(470, 10, 20))).toBe('Added 480 words; 20 you know were skipped');
		expect(starterAddedText(plan(1, 0, 0))).toBe('Added 1 word');
	});
});

describe('duplicateGlosses', () => {
	const word = (id: number, written: string, gloss: string) => ({
		id,
		language: 'ja',
		kind: 'word',
		written,
		readings: [],
		attrs: {},
		radicalId: null,
		rank: id,
		gloss
	});

	it('glosses only the words whose display form occurs more than once', () => {
		const got = duplicateGlosses([
			word(1, 'なる', 'to become'),
			word(2, 'の', 'of'),
			word(3, 'なる', 'to bear fruit'),
			word(4, 'いる', '')
		]);
		expect([...got]).toEqual([
			[1, 'to become'],
			[3, 'to bear fruit']
		]);
	});

	it('copes with an older server without glosses', () => {
		const old = [word(1, 'なる', ''), word(2, 'なる', '')].map(({ gloss: _g, ...rest }) => rest);
		expect(duplicateGlosses(old).size).toBe(0);
	});
});
