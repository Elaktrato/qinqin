// How many distinct decks in the current workspace hold a card of an entry
// (#104). The page reads it from the cached study data; nothing new is fetched.

import type { StudyData } from '$lib/studycore/types';

export function decksContaining(study: Pick<StudyData, 'cards'>, entryId: number): number {
	const decks = new Set<string>();
	for (const card of study.cards) {
		if (card.entryId === entryId) for (const id of card.deckIds) decks.add(id);
	}
	return decks.size;
}
