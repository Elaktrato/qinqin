import { describe, expect, it } from 'vitest';

import { strongReviews } from '../testing/reviews';
import { DEFAULT_W } from './fsrs/params';
import { levelMastery } from './levelMastery';
import type { StudyCard } from './types';

const NOW = new Date('2027-06-01T00:00:00.000Z');

function card(id: string, written: string): StudyCard {
	return { id, kind: 'vocab', entryId: 1, written, deckIds: ['general'], createdAt: '2025-01-01T00:00:00Z' };
}

const levels = [
	{ levelId: 1, name: 'N5', chars: new Set(['日', '月', '火']) },
	{ levelId: 2, name: 'N4', chars: new Set(['水', '日']) },
	{ levelId: 3, name: 'N3', chars: new Set<string>() }
];

describe('levelMastery', () => {
	it('counts a character of a strong card as learned', () => {
		const cards = [card('a', '日')];
		const result = levelMastery(levels, cards, strongReviews('a'), NOW, DEFAULT_W);
		expect(result.get('N5')).toEqual({ learned: 1, total: 3 });
	});

	it('counts a duplicate inside a level once and an empty level as 0 of 0', () => {
		const cards = [card('a', '日日')];
		const result = levelMastery(
			[{ levelId: 1, name: 'N5', chars: new Set(['日']) }, levels[2]],
			cards,
			strongReviews('a'),
			NOW,
			DEFAULT_W
		);
		expect(result.get('N5')).toEqual({ learned: 1, total: 1 });
		expect(result.get('N3')).toEqual({ learned: 0, total: 0 });
	});

	it('does not count an unreviewed or weak character', () => {
		const result = levelMastery(levels, [card('a', '水')], [], NOW, DEFAULT_W);
		expect(result.get('N4')).toEqual({ learned: 0, total: 2 });
	});
});
