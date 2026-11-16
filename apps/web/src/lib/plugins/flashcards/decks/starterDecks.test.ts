import { describe, expect, it } from 'vitest';
import fixture from '../../../../../../../docs/contracts/frequency/starter-deck-ids.json';
import type { FrequencyPack } from '$lib/api/types';
import { ownedStarterDeckId } from './systemDecks';
import {
	STARTER_SIZES,
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
});
