import { describe, expect, it } from 'vitest';

import type { Deck, StudyCard } from '$lib/study/types';
import { deleteDeckText } from './deleteText';

const deck = (id: string, name: string): Deck => ({ id, name, createdAt: '2026-01-01T00:00:00.000Z' });
const card = (n: number, deckIds: string[]): StudyCard => ({
	id: `c-vocab-${n}`,
	kind: 'vocab',
	entryId: n,
	deckIds,
	createdAt: '2026-01-01T00:00:00.000Z'
});

describe('deleteDeckText', () => {
	const target = deck('d1', 'Greetings');
	const verbs = deck('d2', 'Verbs');

	it('names General when the cards have no other deck', () => {
		const cards = Array.from({ length: 12 }, (_, i) => card(i, ['d1']));
		expect(deleteDeckText(target, cards, [target, verbs])).toBe('Delete “Greetings”? Its 12 cards move to General.');
	});

	it('uses the singular', () => {
		expect(deleteDeckText(target, [card(1, ['d1'])], [target])).toBe('Delete “Greetings”? Its 1 card moves to General.');
	});

	it('splits the cards by destination', () => {
		const cards = [
			...Array.from({ length: 3 }, (_, i) => card(i, ['d1', 'd2'])),
			...Array.from({ length: 9 }, (_, i) => card(10 + i, ['d1']))
		];
		expect(deleteDeckText(target, cards, [target, verbs])).toBe(
			'Delete “Greetings”? Its 12 cards: 3 stay in Verbs, 9 move to General.'
		);
	});

	it('ignores decks that no longer exist and cards of other decks', () => {
		const cards = [card(1, ['d1', 'gone']), card(2, ['d2'])];
		expect(deleteDeckText(target, cards, [target, verbs])).toBe('Delete “Greetings”? Its 1 card moves to General.');
	});

	it('an empty deck has nothing to move', () => {
		expect(deleteDeckText(target, [], [target])).toBe('Delete “Greetings”? It has no cards.');
	});

	it('a card already in General stays there', () => {
		expect(deleteDeckText(target, [card(1, ['d1', 'general'])], [target])).toBe(
			'Delete “Greetings”? Its 1 card stays in General.'
		);
	});
});
