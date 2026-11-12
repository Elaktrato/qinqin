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

/** Anki-style grades: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type ReviewGrade = 1 | 2 | 3 | 4;

/** The payload of a `review` study event. */
export interface ReviewPayload {
	cardId: string;
	mode: StudyCardKind;
	grade: ReviewGrade;
}

/**
 * One review as the append-only event log stores it. A card's schedule
 * is derived by replaying these events; it is never written anywhere.
 */
export interface ReviewEvent {
	id: string;
	workspaceId: number;
	device: string;
	ts: string;
	type: 'review';
	payload: ReviewPayload;
}

/** One study card. A card may belong to several decks at once. */
export interface StudyCard {
	id: string;
	kind: StudyCardKind;
	entryId: number;
	// The entry's written form as it looked when the card was added. It is
	// a snapshot: later analysis uses it without another entry fetch.
	// Cards added before this field existed have no snapshot.
	written?: string;
	sentenceId?: number;
	deckIds: string[];
	createdAt: string;
}

/** Everything a study page needs: the decks and the cards in them. */
export interface StudyData {
	decks: Deck[];
	cards: StudyCard[];
}
