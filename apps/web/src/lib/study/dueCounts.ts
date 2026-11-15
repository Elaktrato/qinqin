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
import type { StudyContext } from './studyContext';
import type { ReviewEvent, StudyCard, StudyCardKind } from './types';

const UNLIMITED = 1_000_000;

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
	const base = { cards: allowed, reviews, deckIds, now, kinds, w, scheduleOf, ctx: input.ctx };
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
