// Known words (#75): an entry is known when one of its live vocab cards
// scores at least MASTERY_THRESHOLD — the decks view's "mastered" and the
// reader's smart readings use the same score. Starter decks skip known
// words. Contract: docs/contracts/frequency/known.json.
//
// #68 adds a manual mark; extend this predicate, never fork it.

import { MASTERY_THRESHOLD, cardScore } from './mastery';
import type { Schedule } from './scheduler';
import type { StudyCard } from './types';

/**
 * knownEntries returns the entry ids whose best live vocab card scores at
 * least the threshold. `cards` are the live cards; `scheduleOf` gives a
 * card's derived schedule (null = never reviewed).
 */
export function knownEntries(
	cards: readonly StudyCard[],
	scheduleOf: (cardId: string) => Schedule | null
): Set<number> {
	const known = new Set<number>();
	for (const card of cards) {
		if (card.kind !== 'vocab' || known.has(card.entryId)) continue;
		const schedule = scheduleOf(card.id);
		if (schedule !== null && cardScore(schedule.stability) >= MASTERY_THRESHOLD) {
			known.add(card.entryId);
		}
	}
	return known;
}
