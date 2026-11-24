// The rows of the decks list: General (only when it holds cards), then the
// user's decks by name, each with its numbers, plus the overall numbers.

import { GENERAL_DECK_ID } from '$lib/study/types';
import { enabledKinds, type DeckSettings } from '$lib/study/deckSettings';
import type { Deck, ReviewEvent, StudyCard, StudyCardKind } from '$lib/study/types';
import type { StudyContext } from '$lib/study/studyContext';
import { deckNumbers, type DeckNumbers, type ScheduleIndex } from './deckStats';

export interface DeckSummary {
	id: string;
	name: string;
	numbers: DeckNumbers;
	/** The kinds a session over this deck studies. */
	kinds: StudyCardKind[];
	/** The deck enables reverse or cloze: more cards appear as the learner studies. */
	extras: boolean;
}

export interface SummarizeInput {
	decks: readonly Deck[];
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckSettings: Record<string, DeckSettings>;
	index: ScheduleIndex;
	now: Date;
	w: readonly number[];
	ctx: StudyContext;
	addDays: (day: string, n: number) => string;
	/** The effective kinds of a session over these decks (deckKinds). */
	kindsFor: (deckIds: string[]) => StudyCardKind[];
}

export function summarizeDecks(input: SummarizeInput): { overall: DeckNumbers; decks: DeckSummary[] } {
	const { kindsFor, ...shared } = input;
	const numbersFor = (deckId: string | null, kinds: StudyCardKind[]): DeckNumbers =>
		deckNumbers({ ...shared, deckId, kinds });
	const entry = (id: string, name: string): DeckSummary => {
		const kinds = kindsFor([id]);
		return {
			id,
			name,
			kinds,
			numbers: numbersFor(id, kinds),
			extras: enabledKinds(input.deckSettings, [id]).size > 0
		};
	};
	const user = [...input.decks]
		.filter((deck) => deck.id !== GENERAL_DECK_ID)
		.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1))
		.map((deck) => entry(deck.id, deck.name));
	const general = entry(GENERAL_DECK_ID, 'General');
	const allIds = [GENERAL_DECK_ID, ...input.decks.map((deck) => deck.id)];
	return {
		overall: numbersFor(null, kindsFor(allIds)),
		decks: [...(general.numbers.cards > 0 ? [general] : []), ...user]
	};
}
