// "Practise my mistakes" (#227): the notebook's cards that are due now become a flashcards session limited to them
// (a card is never asked before it is due: FSRS would count it as a review and spend its spacing).

import { DEFAULT_CONFIG, newSessionSeed, type StudySessionConfig } from '$lib/features/flashcards/session/session';
import { scheduleFor } from '$lib/studycore/scheduler';
import { isDueNow, type StudyContext } from '$lib/studycore/studyContext';
import { CARD_KINDS, type ReviewEvent } from '$lib/studycore/types';

/** dueCardIds: the cards of the list whose schedule is due at `now` (none on a vacation day). */
export function dueCardIds(
	cardIds: readonly string[],
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[],
	ctx: StudyContext
): string[] {
	const byCard = new Map<string, ReviewEvent[]>();
	for (const r of reviews) {
		const list = byCard.get(r.payload.cardId);
		if (list === undefined) byCard.set(r.payload.cardId, [r]);
		else list.push(r);
	}
	return cardIds.filter((id) => {
		const schedule = scheduleFor(id, byCard.get(id) ?? [], now, w, ctx.clock);
		return schedule !== null && isDueNow(schedule, now, ctx);
	});
}

/** cardSessionConfig: a deck session over every deck and card kind, limited to these cards, without daily limits. */
export function cardSessionConfig(deckIds: readonly string[], cardIds: readonly string[], from: string, seed: number = newSessionSeed()): StudySessionConfig {
	return {
		...DEFAULT_CONFIG,
		deckIds: [...deckIds],
		cardTypes: [...CARD_KINDS],
		studyAll: true,
		cardIds: [...cardIds],
		seed,
		from
	};
}
