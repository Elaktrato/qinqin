// Scheduling is derived, never stored: a card's state is whatever
// replaying its review events through ts-fsrs produces. That keeps the
// server log authoritative and makes a schedule reproducible on any
// device from the same events.

import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';

import { weightsKey } from './fsrs/params';
import { feedInstants, type StudyClock } from './studyClock';
import { isDueNow, type StudyContext } from './studyContext';
import type { ReviewEvent, ReviewGrade, StudyCard, StudyCardKind } from './types';

/** The derived schedule of one card. `due` is an RFC 3339 instant. */
export interface Schedule {
	due: string;
	stability: number;
	difficulty: number;
	state: number;
}

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
}

// One scheduler instance per weight set: instances are stateless between
// calls, so equal weights share one. Every other option stays the
// ts-fsrs default (fuzz off, short-term on).
const MAX_SCHEDULERS = 16;
const schedulers = new Map<string, ReturnType<typeof fsrs>>();

function schedulerFor(w: readonly number[]): ReturnType<typeof fsrs> {
	const key = weightsKey(w);
	let instance = schedulers.get(key);
	if (instance === undefined) {
		if (schedulers.size >= MAX_SCHEDULERS) {
			const oldest = schedulers.keys().next().value;
			if (oldest !== undefined) schedulers.delete(oldest);
		}
		instance = fsrs({ w: [...w] });
		schedulers.set(key, instance);
	}
	return instance;
}

/** schedulerCacheSize is the number of memoised instances (for tests). */
export function schedulerCacheSize(): number {
	return schedulers.size;
}

// Map the Anki grades explicitly instead of relying on numeric parity:
// 1 Again, 2 Hard, 3 Good, 4 Easy.
const RATING: Record<ReviewGrade, Grade> = {
	1: Rating.Again,
	2: Rating.Hard,
	3: Rating.Good,
	4: Rating.Easy
};

function instant(ts: string): number {
	const ms = Date.parse(ts);
	return Number.isNaN(ms) ? 0 : ms;
}

/**
 * isValidReview guards the replay against out-of-contract payloads. The
 * server only validates a review's id and ts, so a stored grade can be
 * anything; ts-fsrs throws on unknown grades and would otherwise break
 * every queue build.
 */
export function isValidReview(review: ReviewEvent): boolean {
	if (review === null || typeof review !== 'object') return false;
	if (typeof review.ts !== 'string' || Number.isNaN(Date.parse(review.ts))) return false;
	const payload: unknown = review.payload;
	if (typeof payload !== 'object' || payload === null) return false;
	const { cardId, grade } = payload as { cardId?: unknown; grade?: unknown };
	if (typeof cardId !== 'string' || cardId.length === 0) return false;
	return grade === 1 || grade === 2 || grade === 3 || grade === 4;
}

function byId(a: { id: string }, b: { id: string }): number {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * sortedReviews orders a card's history by event time, then by id so
 * two events written in the same millisecond still replay in the same
 * order on every device.
 */
export function sortedReviews(reviews: readonly ReviewEvent[]): ReviewEvent[] {
	return [...reviews].sort((a, b) => instant(a.ts) - instant(b.ts) || byId(a, b));
}

/**
 * scheduleFor replays one card's reviews from an empty card and returns
 * its derived schedule. `null` means the card has never been reviewed.
 * `now` is accepted for a stable "as of" API; the result depends only
 * on the history, so two calls with the same events agree exactly.
 * Reviews are fed to ts-fsrs on the study clock (vacation days removed)
 * and the due is mapped back (docs/contracts/scheduler/).
 */
export function scheduleFor(
	cardId: string,
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[],
	clock: StudyClock
): Schedule | null {
	void now;
	const scheduler = schedulerFor(w);

	const history = sortedReviews(
		reviews.filter((review) => isValidReview(review) && review.payload.cardId === cardId)
	);
	if (history.length === 0) return null;

	const fed = feedInstants(
		history.map((review) => instant(review.ts)),
		clock
	);
	let card: Card = createEmptyCard(new Date(fed[0]));
	history.forEach((review, i) => {
		card = scheduler.next(card, new Date(fed[i]), RATING[review.payload.grade]).card;
	});

	return {
		due: new Date(clock.inverse(card.due.getTime())).toISOString(),
		stability: card.stability,
		difficulty: card.difficulty,
		state: card.state as number
	};
}

/** isDue reports whether a schedule has reached its due instant. */
export function isDue(schedule: Schedule, now: Date): boolean {
	return instant(schedule.due) <= now.getTime();
}

function cap(limit: number): number {
	if (!Number.isFinite(limit)) return 0;
	return Math.max(0, Math.floor(limit));
}

/**
 * buildQueue assembles one session: reviewed cards that are due first,
 * earliest due first, then never-reviewed cards. Reviewed cards that
 * are not due yet are neither reviews nor new, so they are omitted.
 * Only cards belonging to one of `deckIds` are considered.
 */
export function buildQueue({
	cards,
	reviews,
	deckIds,
	newLimit,
	reviewLimit,
	now,
	ctx,
	kinds,
	w,
	scheduleOf
}: BuildQueueOptions): StudyCard[] {
	if (ctx.vacationToday) return [];
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

	return [
		...due.slice(0, cap(reviewLimit)).map((entry) => entry.card),
		...fresh.slice(0, cap(newLimit))
	];
}

// XP lives in exp.ts; re-exported so existing imports keep working.
export { levelFromXp, xpFromReviews } from './exp';
