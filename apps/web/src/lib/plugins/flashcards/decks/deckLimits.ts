// What is left of today's daily limits for one deck (or everything): the
// number the decks list and detail show beside Due and New.

import { dayCountsCached } from '$lib/study/limits';
import { leftToday } from '$lib/study/dueCounts';
import { limitsOf } from '$lib/study/scheduler';
import type { DeckSettings } from '$lib/study/deckSettings';
import type { ScheduleIndex } from './deckStats';
import type { StudyContext } from '$lib/study/studyContext';
import type { ReviewEvent, StudyCard, StudyCardKind } from '$lib/study/types';
import type { LimitsLeftToday } from './DeckLimitsSlot';

export interface LeftInput {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckSettings?: Record<string, DeckSettings>;
	now: Date;
	weights: readonly number[];
	ctx: StudyContext;
	index: ScheduleIndex;
}

/**
 * deckLeftToday admits the deck's due and new real cards through the daily
 * limits of every deck they are in (burying applied first, like a session).
 * A field whose own limit is unlimited is null: there is nothing to show.
 */
export function deckLeftToday(
	input: LeftInput,
	deckId: string,
	kinds: readonly StudyCardKind[]
): LimitsLeftToday {
	const { cards, reviews, ctx, now } = input;
	const left = leftToday({
		cards,
		reviews,
		deckIds: [deckId],
		kinds,
		deckSettings: input.deckSettings,
		now,
		w: input.weights,
		ctx,
		scheduleOf: (id) => input.index.get(id) ?? null,
		counts: dayCountsCached(cards, reviews, ctx, now)
	});
	const limit = limitsOf(ctx, deckId);
	return {
		new: limit.new === null ? null : left.new,
		reviews: limit.reviews === null ? null : left.reviews
	};
}
