// The queue of one session (#278: split from scheduler.ts, which keeps the derived schedules): the due cards,
// earliest due first, then the never-reviewed ones, admitted under the session caps and the daily limits.

import { orderNew } from './newOrder';
import { compareById, instantOf, isValidReview } from './reviewOrder';
import { isDueNow, type StudyContext } from './studyContext';
import { dayCountsCached, type Candidate, type DayCounts } from './limits';
import { admitSession } from './sessionQueue';
import { scheduleFor, type Schedule } from './scheduler';
import type { ReviewEvent, StudyCard, StudyCardKind } from './types';

const instant = instantOf;
const byId = compareById;

export interface BuildQueueOptions {
	cards: readonly StudyCard[];
	reviews: readonly ReviewEvent[];
	deckIds: readonly string[];
	newLimit: number;
	reviewLimit: number;
	now: Date;
	/** The study clock and vacation state of the workspace. */
	ctx: StudyContext;
	/** Card kinds to include; every kind when omitted. */
	kinds?: readonly StudyCardKind[];
	/** The workspace's active FSRS weights (`activeWeights(history)`). */
	w: readonly number[];
	/**
	 * A ready schedule lookup (the decks view builds one index for many
	 * counts). Absent: each card's history is replayed. null = never reviewed.
	 */
	scheduleOf?: (cardId: string) => Schedule | null;
	/**
	 * What today already used (limits.ts). Absent: counted from `cards` and
	 * `reviews`; the decks view passes one shared count for many queues.
	 */
	counts?: DayCounts;
	/**
	 * The new-card order (#75): a key per never-reviewed card, lower
	 * first, null after every keyed card (orderNew). Absent: the order
	 * added. Reviews and the due order are unchanged.
	 */
	newKey?: (card: StudyCard) => number | null;
}

/**
 * buildQueue assembles one session: reviewed cards that are due first,
 * earliest due first, then never-reviewed cards. Reviewed cards that
 * are not due yet are neither reviews nor new, so they are omitted.
 * Only cards belonging to one of `deckIds` are considered.
 */
export function buildQueue(options: BuildQueueOptions): StudyCard[] {
	const { newLimit, reviewLimit, ctx } = options;
	const { candidates, byId: cardById, counts } = queueCandidates(options);
	const { inSession } = admitSession({ candidates, ctx, counts, caps: { newLimit, reviewLimit } });
	return candidates.filter((c) => inSession.has(c.cardId)).map((c) => cardById.get(c.cardId) as StudyCard);
}

/**
 * queueCandidates lists what a queue could hold before any limit: the due
 * cards (earliest due first), then the never-reviewed ones, each with its
 * decks and bucket for admit(). Empty on a vacation day.
 */
export function queueCandidates({
	cards,
	reviews,
	deckIds,
	now,
	ctx,
	kinds,
	w,
	scheduleOf,
	counts,
	newKey
}: BuildQueueOptions): { candidates: Candidate[]; byId: Map<string, StudyCard>; counts: DayCounts } {
	const dayUsed = counts ?? dayCountsCached(cards, reviews, ctx, now);
	if (ctx.vacationToday) return { candidates: [], byId: new Map(), counts: dayUsed };
	const wanted = new Set(deckIds);
	const scoped = cards.filter(
		(card) =>
			card.deckIds.some((id) => wanted.has(id)) && (kinds === undefined || kinds.includes(card.kind))
	);

	const historyByCard = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
		if (!isValidReview(review)) continue;
		const history = historyByCard.get(review.payload.cardId);
		if (history === undefined) {
			historyByCard.set(review.payload.cardId, [review]);
		} else {
			history.push(review);
		}
	}

	const due: { card: StudyCard; at: number }[] = [];
	const fresh: StudyCard[] = [];

	for (const card of scoped) {
		const history = historyByCard.get(card.id);
		if (scheduleOf === undefined && history === undefined) {
			fresh.push(card);
			continue;
		}
		const schedule =
			scheduleOf === undefined ? scheduleFor(card.id, history ?? [], now, w, ctx.clock) : scheduleOf(card.id);
		if (scheduleOf !== undefined && schedule === null) {
			fresh.push(card);
			continue;
		}
		if (schedule !== null && isDueNow(schedule, now, ctx)) {
			due.push({ card, at: instant(schedule.due) });
		}
	}

	due.sort((a, b) => a.at - b.at || byId(a.card, b.card));
	fresh.sort((a, b) => instant(a.createdAt) - instant(b.createdAt) || byId(a, b));
	const ordered = newKey === undefined ? fresh : orderNew(fresh, newKey);

	const candidates: Candidate[] = [
		...due.map(({ card }) => ({
			cardId: card.id,
			deckIds: card.deckIds,
			bucket: dayUsed.reviewedToday.has(card.id) ? ('continuing' as const) : ('review' as const)
		})),
		...ordered.map((card) => ({ cardId: card.id, deckIds: card.deckIds, bucket: 'new' as const }))
	];
	const map = new Map([...due.map((e) => e.card), ...ordered].map((card) => [card.id, card]));
	return { candidates, byId: map, counts: dayUsed };
}
