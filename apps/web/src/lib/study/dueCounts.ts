// What can be studied now, counted: due reviews and new cards of the
// existing (stored) cards. Cards that may not be shown (their opt-in kind
// is off for the deck, the word skips them, or a sibling answered today
// buried them) are removed first, exactly like a session's plan, so a
// count never promises a card the session will not show. Virtual
// companions that do not exist yet are not counted (the setup summary
// counts them through deckSessionItems).

import { allowedReal, skipKindsByEntry, vocabEntryIds } from './cardFlow';
import type { DeckSettings } from './deckSettings';
import { buriedNow } from './siblings';
import { buildQueue, type Schedule } from './scheduler';
import type { LimitRows, StudyContext } from './studyContext';
import { dayCountsCached, type DayCounts } from './limits';
import type { ReviewEvent, StudyCard, StudyCardKind } from './types';

const UNLIMITED = 1_000_000;

/** Limits that never refuse anything. */
const NO_DAILY_LIMITS: LimitRows = {
	workspace: { new: null, reviews: null },
	decks: {},
	existingDecks: null
};
const EMPTY_COUNTS: DayCounts = {
	newDone: new Map(),
	reviewDone: new Map(),
	reviewedToday: new Set(),
	firstDay: new Map()
};

export function dueCounts(input: {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckIds: readonly string[];
	kinds: readonly StudyCardKind[];
	deckSettings?: Record<string, DeckSettings>;
	now: Date;
	w: readonly number[];
	ctx: StudyContext;
	newLimit?: number;
	reviewLimit?: number;
	scheduleOf?: (cardId: string) => Schedule | null;
	/**
	 * Apply the daily limits (the home widget's and the study start's "left
	 * today"). Off by default: the decks view shows what is due and new, with
	 * the allowance beside it (limitsLeft.ts).
	 */
	applyDailyLimits?: boolean;
	/** What today already used, shared by many counts (limits.ts). */
	counts?: DayCounts;
}): { due: number; fresh: number } {
	const { cards, reviews, deckIds, kinds, deckSettings, now, w, scheduleOf } = input;
	const buried = buriedNow({ cards, reviews, now, studyDay: input.ctx.day });
	const skipByEntry = skipKindsByEntry(cards);
	const vocabEntries = vocabEntryIds(cards);
	const allowed = cards.filter(
		(card) =>
			!buried.cardIds.has(card.id) &&
			allowedReal(card, { sessionDecks: deckIds, deckSettings, skipByEntry, vocabEntries })
	);
	// Counting uses every card (all kinds), not only the ones shown.
	const used = input.applyDailyLimits === true ? (input.counts ?? dayCountsCached(cards, reviews, input.ctx, now)) : undefined;
	const ctx = input.applyDailyLimits === true ? input.ctx : { ...input.ctx, limits: NO_DAILY_LIMITS };
	const base = { cards: allowed, reviews, deckIds, now, kinds, w, scheduleOf, ctx, counts: used ?? EMPTY_COUNTS };
	return {
		due: buildQueue({
			...base,
			newLimit: 0,
			reviewLimit: input.reviewLimit ?? UNLIMITED
		}).length,
		fresh: buildQueue({
			...base,
			newLimit: input.newLimit ?? UNLIMITED,
			reviewLimit: 0
		}).length
	};
}
