// The study layer's persistent shapes. Deck and card definitions live in
// the workspace-scoped plugin data store, keyed `deck:<id>` and
// `card:<id>`; review history and scheduling are separate (events, never
// stored schedules).

/** One user-created deck. The implicit `general` deck has no stored row. */
export interface Deck {
	id: string;
	name: string;
	createdAt: string;
}

// Round 1 only understands vocab cards; the data model reserves
// sentence, writing and tone kinds for later rounds.
export type StudyCardKind = 'vocab';

/** One study card. A card may belong to several decks at once. */
export interface StudyCard {
	id: string;
	kind: StudyCardKind;
	entryId: number;
	sentenceId?: number;
	deckIds: string[];
	createdAt: string;
}

/** Everything a study page needs: the decks and the cards in them. */
export interface StudyData {
	decks: Deck[];
	cards: StudyCard[];
}
