// Word states: how far each studied word has come, derived from the
// flashcard schedule (never stored). A word is one vocab card; sentence,
// writing and tone cards practise a word already counted, so they are
// left out of these numbers.
//
// New = never reviewed; Learning = the FSRS learning or relearning
// state; Young = in review with a stability under 21 days; Mature = 21
// days or more (the same edge the Word Salad tiers use).

import { t, type MessageKey } from '$lib/i18n';
import { GENERAL_DECK_ID } from '$lib/study/store';
import { scheduleFor, type Schedule } from '$lib/study/scheduler';
import type { StudyClock } from '$lib/study/studyClock';
import type { Deck, ReviewEvent, StudyCard } from '$lib/study/types';

export type WordState = 'new' | 'learning' | 'young' | 'mature';

/** The four states in display order, with their visible names. */
function wordState(state: WordState, label: MessageKey): { state: WordState; readonly label: string } {
	return {
		state,
		get label() {
			return t(label);
		}
	};
}

export const WORD_STATES: readonly { state: WordState; readonly label: string }[] = [
	wordState('new', 'stats.wordState.new'),
	wordState('learning', 'stats.wordState.learning'),
	wordState('young', 'stats.wordState.young'),
	wordState('mature', 'stats.wordState.mature')
];

/** Stability in days from which a word in review counts as mature. */
export const MATURE_STABILITY_DAYS = 21;

// ts-fsrs State values.
const STATE_NEW = 0;
const STATE_REVIEW = 2;

export type WordStateCounts = Record<WordState, number> & { total: number };

export interface DeckWordStates {
	id: string;
	name: string;
	counts: WordStateCounts;
}

export interface WordStatesResult {
	/** Every vocab card in at least one existing deck, counted once. */
	overall: WordStateCounts;
	/** General (only when it holds cards), then the user's decks in order. */
	decks: DeckWordStates[];
}

export function emptyCounts(): WordStateCounts {
	return { new: 0, learning: 0, young: 0, mature: 0, total: 0 };
}

/** classifySchedule maps a derived schedule (null = never reviewed) to a word state. */
export function classifySchedule(schedule: Pick<Schedule, 'state' | 'stability'> | null): WordState {
	if (schedule === null || schedule.state === STATE_NEW) return 'new';
	if (schedule.state !== STATE_REVIEW) return 'learning';
	return schedule.stability >= MATURE_STABILITY_DAYS ? 'mature' : 'young';
}

type ScheduleFn = (cardId: string, history: readonly ReviewEvent[], now: Date,
	w: readonly number[], clock: StudyClock
) => Schedule | null;

function reviewsByCard(reviews: readonly ReviewEvent[]): Map<string, ReviewEvent[]> {
	const byCard = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
		const cardId = (review?.payload as { cardId?: unknown } | undefined)?.cardId;
		if (typeof cardId !== 'string' || cardId === '') continue;
		const list = byCard.get(cardId);
		if (list === undefined) byCard.set(cardId, [review]);
		else list.push(review);
	}
	return byCard;
}

/**
 * wordStateCounts classifies every vocab card of `cards` (the merged
 * data of loadStudyData) and counts them overall and per deck. A card in
 * several decks counts in each deck's row but once overall. Deck ids
 * that no longer exist are ignored; a card left in no existing deck is
 * not studied anywhere and is not counted. `schedule` is injectable for
 * tests; it defaults to the real FSRS replay.
 */
export function wordStateCounts(
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	decks: readonly Deck[],
	now: Date,
	w: readonly number[],
	clock: StudyClock,
	schedule: ScheduleFn = scheduleFor
): WordStatesResult {
	const rows: DeckWordStates[] = [
		{ id: GENERAL_DECK_ID, name: 'General', counts: emptyCounts() },
		...decks
			.filter((deck) => deck.id !== GENERAL_DECK_ID)
			.map((deck) => ({ id: deck.id, name: deck.name, counts: emptyCounts() }))
	];
	const rowById = new Map(rows.map((row) => [row.id, row]));
	const overall = emptyCounts();
	const history = reviewsByCard(reviews);

	for (const card of cards) {
		if (card.kind !== 'vocab') continue;
		const inRows = [...new Set(card.deckIds)]
			.map((id) => rowById.get(id))
			.filter((row): row is DeckWordStates => row !== undefined);
		if (inRows.length === 0) continue;

		const state = classifySchedule(schedule(card.id, history.get(card.id) ?? [], now, w, clock));
		overall[state] += 1;
		overall.total += 1;
		for (const row of inRows) {
			row.counts[state] += 1;
			row.counts.total += 1;
		}
	}

	return {
		overall,
		decks: rows.filter((row) => row.id !== GENERAL_DECK_ID || row.counts.total > 0)
	};
}

const SUMMARY: Record<WordState, MessageKey> = {
	new: 'stats.wordStateSummary.new',
	learning: 'stats.wordStateSummary.learning',
	young: 'stats.wordStateSummary.young',
	mature: 'stats.wordStateSummary.mature'
};

/** wordStateSummary is the bar's text alternative, e.g. "16 words: 3 new, 1 learning, …". */
export function wordStateSummary(counts: WordStateCounts): string {
	const parts = WORD_STATES.map(({ state }) => t(SUMMARY[state], { count: counts[state] }));
	return t('stats.wordStateSummary.text', { count: counts.total, parts: parts.join(', ') });
}

/** wordStateShares are the non-empty parts of the stacked bar, in percent. */
export function wordStateShares(counts: WordStateCounts): { state: WordState; share: number }[] {
	if (counts.total === 0) return [];
	return WORD_STATES.filter(({ state }) => counts[state] > 0).map(({ state }) => ({
		state,
		share: (100 * counts[state]) / counts.total
	}));
}
