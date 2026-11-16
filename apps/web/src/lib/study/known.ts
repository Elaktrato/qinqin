// Known words (#75, #68): the one predicate the reader's word states, smart
// readings and starter decks share. An entry is known when the learner
// marked it ("I know this word", a live known:<entryId> row) or one of its
// live vocab cards scores at least the threshold (MASTERY_THRESHOLD unless
// the reader passes its own smartThreshold); learning when it has a live
// vocab card; new otherwise. Contracts: docs/contracts/frequency/known.json,
// docs/contracts/reader/word-states.json.
//
// Extend this predicate, never fork it.

import { MASTERY_THRESHOLD, cardScore } from './mastery';
import type { Schedule } from './scheduler';
import type { StudyCard } from './types';

export type Familiarity = 'new' | 'learning' | 'known';

export interface KnownIndex {
	/** entry -> best cardScore of its reviewed live vocab cards. */
	scores: ReadonlyMap<number, number>;
	/** Entries with a live vocab card (reviewed or not). */
	carded: ReadonlySet<number>;
	/** The learner's manual known marks. */
	marks: ReadonlySet<number>;
}

export const EMPTY_KNOWN_INDEX: KnownIndex = { scores: new Map(), carded: new Set(), marks: new Set() };

/**
 * knownIndex builds the index from the live cards, a card's derived
 * schedule (null = never reviewed) and the live marks. One loop over the
 * cards; only vocab cards count.
 */
export function knownIndex(
	cards: readonly StudyCard[],
	scheduleOf: (cardId: string) => Pick<Schedule, 'stability'> | null,
	marks: Iterable<number> = []
): KnownIndex {
	const scores = new Map<number, number>();
	const carded = new Set<number>();
	for (const card of cards) {
		if (card.kind !== 'vocab') continue;
		carded.add(card.entryId);
		const schedule = scheduleOf(card.id);
		if (!schedule) continue;
		const score = cardScore(schedule.stability);
		const best = scores.get(card.entryId);
		if (best === undefined || score > best) scores.set(card.entryId, score);
	}
	return { scores, carded, marks: new Set(marks) };
}

/** familiarity of one entry; the mark wins over every card and threshold. */
export function familiarity(entryId: number, index: KnownIndex, threshold: number = MASTERY_THRESHOLD): Familiarity {
	if (index.marks.has(entryId)) return 'known';
	const score = index.scores.get(entryId);
	if (score !== undefined && score >= threshold) return 'known';
	return index.carded.has(entryId) ? 'learning' : 'new';
}

export function isKnownEntry(entryId: number, index: KnownIndex, threshold: number = MASTERY_THRESHOLD): boolean {
	return familiarity(entryId, index, threshold) === 'known';
}

/**
 * knownEntries returns the known entry ids among the cards' entries and the
 * marks, at MASTERY_THRESHOLD. `cards` are the live cards; `scheduleOf`
 * gives a card's derived schedule (null = never reviewed); `marks` are the
 * live manual marks.
 */
export function knownEntries(
	cards: readonly StudyCard[],
	scheduleOf: (cardId: string) => Pick<Schedule, 'stability'> | null,
	marks: Iterable<number> = []
): Set<number> {
	const index = knownIndex(cards, scheduleOf, marks);
	const known = new Set<number>(index.marks);
	for (const entryId of index.scores.keys()) {
		if (isKnownEntry(entryId, index)) known.add(entryId);
	}
	return known;
}
