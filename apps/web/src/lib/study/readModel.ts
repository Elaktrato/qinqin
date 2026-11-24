// Pure views of a workspace's study rows (#193): what the pages, widgets and
// planners read. No network, no storage: the cache (cache.ts) holds the rows,
// data.ts hands these views out.

import { DEFAULT_W } from './fsrs/params';
import type { StudyCard, StudyData } from './types';

/** activeWeights is the workspace's FSRS weights; the defaults without a set. */
export function activeWeights(data: Pick<StudyData, 'fsrs'>): readonly number[] {
	return data.fsrs?.w ?? DEFAULT_W;
}

/** cardsInDecks keeps the cards that belong to at least one of `deckIds`. */
export function cardsInDecks(cards: readonly StudyCard[], deckIds: readonly string[]): StudyCard[] {
	const wanted = new Set(deckIds);
	return cards.filter((card) => card.deckIds.some((id) => wanted.has(id)));
}
