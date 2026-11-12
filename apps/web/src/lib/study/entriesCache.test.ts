import { describe, expect, it } from 'vitest';

import { missingWrittenEntryIds, withWritten } from './entriesCache';
import type { StudyCard } from './types';

function card(id: string, entryId: number, written?: string): StudyCard {
	const result: StudyCard = {
		id,
		kind: 'vocab',
		entryId,
		deckIds: ['general'],
		createdAt: '2025-01-01T00:00:00.000Z'
	};
	if (written !== undefined) result.written = written;
	return result;
}

describe('missingWrittenEntryIds', () => {
	it('lists unique entry ids of cards without a snapshot', () => {
		const cards = [
			card('c1', 10, '猫'),
			card('c2', 11),
			card('c3', 11),
			card('c4', 12, '')
		];

		expect(missingWrittenEntryIds(cards)).toEqual([11]);
	});

	it('reports nothing when every card has a snapshot', () => {
		expect(missingWrittenEntryIds([card('c1', 10, '猫'), card('c2', 11, '')])).toEqual([]);
	});
});

describe('withWritten', () => {
	it('fills only cards without a snapshot', () => {
		const resolved = new Map<number, string | null>([
			[10, '狗'],
			[11, null]
		]);
		const cards = [card('known', 10, '猫'), card('legacy', 10), card('missing', 11)];

		const filled = withWritten(cards, resolved);

		expect(filled[0].written).toBe('猫');
		expect(filled[1]).toEqual({ ...cards[1], written: '狗' });
		expect(filled[2].written).toBeUndefined();
	});

	it('leaves a card untouched when its entry could not be resolved', () => {
		const cards = [card('legacy', 11)];

		expect(withWritten(cards, new Map([[11, null]]))).toEqual(cards);
	});

	it('does not mutate the input cards', () => {
		const legacy = card('legacy', 10);
		withWritten([legacy], new Map([[10, '狗']]));

		expect(legacy).toEqual(card('legacy', 10));
	});
});
