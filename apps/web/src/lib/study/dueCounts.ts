// What can be studied now, counted: due reviews and new cards of the
// existing (stored) cards. Cards that may not be shown (their opt-in kind
// is off for the deck, the word skips them, or a sibling answered today
// buried them) are removed first, exactly like a session's plan, so a
// count never promises a card the session will not show. Virtual
// companions that do not exist yet are not counted (the setup summary
// counts them through deckSessionItems).

import { allowedReal, vocabEntryIds } from './cardFlow';
import type { DeckSettings } from './deckSettings';
import { buriedNow } from './siblings';
import type { Schedule } from './scheduler';
import { queueCandidates, type BuildQueueOptions } from './queue';
import type { LimitRows, StudyContext } from './studyContext';
import { dayCountsCached, NO_LIMIT, type Admission, type DayCounts } from './limits';
import { admitSession, skipKindsByEntry } from './sessionQueue';
import type { ReviewEvent, StudyCard, StudyCardKind } from './types';

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

export interface DueCountsInput {
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
}

/** The queue options of a count: buried and switched-off cards left out first. */
function prepare(input: DueCountsInput): BuildQueueOptions {
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
	return {
		cards: allowed,
		reviews,
		deckIds,
		now,
		kinds,
		w,
		scheduleOf,
		ctx,
		counts: used ?? EMPTY_COUNTS,
		newLimit: input.newLimit ?? NO_LIMIT,
		reviewLimit: input.reviewLimit ?? NO_LIMIT
	};
}

export function dueCounts(input: DueCountsInput): { due: number; fresh: number } {
	const base = prepare(input);
	const { candidates, counts } = queueCandidates(base);
	const { inSession } = admitSession({
		candidates,
		ctx: base.ctx,
		counts,
		caps: { newLimit: base.newLimit, reviewLimit: base.reviewLimit }
	});
	let due = 0;
	let fresh = 0;
	for (const candidate of candidates) {
		if (!inSession.has(candidate.cardId)) continue;
		if (candidate.bucket === 'new') fresh += 1;
		else due += 1;
	}
	return { due, fresh };
}

/**
 * leftToday: what the daily limits admit right now for these decks and kinds,
 * session caps removed (sessionQueue.ts `admitSession().left`). Real cards only.
 */
export function leftToday(input: DueCountsInput): Admission['left'] {
	const base = prepare({ ...input, applyDailyLimits: true });
	const { candidates, counts } = queueCandidates(base);
	return admitSession({
		candidates,
		ctx: base.ctx,
		counts,
		caps: { newLimit: NO_LIMIT, reviewLimit: NO_LIMIT }
	}).left;
}
