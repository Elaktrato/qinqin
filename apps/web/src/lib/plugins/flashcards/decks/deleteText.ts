// The confirmation text of deleting a deck: where its cards go. deleteDeck
// (store.ts) strips the deck from every card and moves a card left in no
// deck to General; this names that outcome before the learner confirms.

import { GENERAL_DECK_ID } from '$lib/study/store';
import type { Deck, StudyCard } from '$lib/study/types';

export function deleteDeckText(
	deck: Deck,
	cards: readonly StudyCard[],
	decks: readonly Deck[]
): string {
	const names = new Map<string, string>([[GENERAL_DECK_ID, 'General']]);
	for (const d of decks) names.set(d.id, d.name);
	const inDeck = cards.filter((card) => card.deckIds.includes(deck.id));
	const head = `Delete “${deck.name}”?`;
	if (inDeck.length === 0) return `${head} It has no cards.`;

	const stays = new Map<string, number>();
	let toGeneral = 0;
	for (const card of inDeck) {
		const others = [...new Set(card.deckIds)].filter((id) => id !== deck.id && names.has(id));
		if (others.length === 0) toGeneral += 1;
		else for (const id of others) stays.set(id, (stays.get(id) ?? 0) + 1);
	}
	const total = inDeck.length;
	const noun = total === 1 ? 'card' : 'cards';
	const onlyGeneral = stays.size === 0 || (stays.size === 1 && stays.has(GENERAL_DECK_ID) && toGeneral === 0);
	if (stays.size === 0) {
		return `${head} Its ${total} ${noun} ${total === 1 ? 'moves' : 'move'} to General.`;
	}
	if (onlyGeneral) return `${head} Its ${total} ${noun} ${total === 1 ? 'stays' : 'stay'} in General.`;

	const parts = [...stays]
		.sort((a, b) => (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''))
		.map(([id, n]) => `${n} ${n === 1 ? 'stays' : 'stay'} in ${names.get(id)}`);
	if (toGeneral > 0) parts.push(`${toGeneral} ${toGeneral === 1 ? 'moves' : 'move'} to General`);
	return `${head} Its ${total} ${noun}: ${parts.join(', ')}.`;
}
