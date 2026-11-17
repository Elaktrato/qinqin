// The confirmation text of deleting a deck: where its cards go. deleteDeck
// (store.ts) strips the deck from every card and moves a card left in no
// deck to General; this names that outcome before the learner confirms.

import { GENERAL_DECK_ID } from '$lib/study/store';
import type { Deck, StudyCard } from '$lib/study/types';
import { t } from '$lib/i18n';

export function deleteDeckText(
	deck: Deck,
	cards: readonly StudyCard[],
	decks: readonly Deck[]
): string {
	const names = new Map<string, string>([[GENERAL_DECK_ID, t('flashcards.delete.general')]]);
	for (const d of decks) names.set(d.id, d.name);
	const inDeck = cards.filter((card) => card.deckIds.includes(deck.id));
	const head = t('flashcards.delete.head', { name: deck.name });
	if (inDeck.length === 0) return t('flashcards.delete.noCards', { head });

	const stays = new Map<string, number>();
	let toGeneral = 0;
	for (const card of inDeck) {
		const others = [...new Set(card.deckIds)].filter((id) => id !== deck.id && names.has(id));
		if (others.length === 0) toGeneral += 1;
		else for (const id of others) stays.set(id, (stays.get(id) ?? 0) + 1);
	}
	const total = inDeck.length;
	const onlyGeneral = stays.size === 0 || (stays.size === 1 && stays.has(GENERAL_DECK_ID) && toGeneral === 0);
	if (stays.size === 0) {
		return t('flashcards.delete.allToGeneral', { head, count: total });
	}
	if (onlyGeneral) return t('flashcards.delete.allInGeneral', { head, count: total });

	const parts = [...stays]
		.sort((a, b) => (names.get(a[0]) ?? '').localeCompare(names.get(b[0]) ?? ''))
		.map(([id, n]) => t('flashcards.delete.staysIn', { count: n, deck: names.get(id) ?? id }));
	if (toGeneral > 0) parts.push(t('flashcards.delete.movesToGeneral', { count: toGeneral }));
	return t('flashcards.delete.split', { head, count: total, parts: parts.join(', ') });
}
