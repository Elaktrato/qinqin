// Scheduling is derived, never stored: a card's state is whatever
// replaying its review events through ts-fsrs produces. That keeps the
// server log authoritative and makes a schedule reproducible on any
// device from the same events.

import { createEmptyCard, fsrs, Rating, type Card, type Grade } from 'ts-fsrs';

import type { ReviewEvent, ReviewGrade, StudyCard } from './types';

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
}

// One scheduler instance is enough: it is stateless between calls.
const scheduler = fsrs();

// Map the Anki grades explicitly instead of relying on numeric parity:
// 1 Again, 2 Hard, 3 Good, 4 Easy.
const RATING: Record<ReviewGrade, Grade> = {
	1: Rating.Again,
	2: Rating.Hard,
	3: Rating.Good,
	4: Rating.Easy
};

const GRADE_BONUS: Record<ReviewGrade, number> = {
	1: 0,
	2: 0,
	3: 5,
	4: 10
};

function instant(ts: string): number {
	const ms = Date.parse(ts);
	return Number.isNaN(ms) ? 0 : ms;
}

function byId(a: { id: string }, b: { id: string }): number {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * sortedReviews orders a card's history by event time, then by id so
 * two events written in the same millisecond still replay in the same
 * order on every device.
 */
function sortedReviews(reviews: readonly ReviewEvent[]): ReviewEvent[] {
	return [...reviews].sort((a, b) => instant(a.ts) - instant(b.ts) || byId(a, b));
}

/**
 * scheduleFor replays one card's reviews from an empty card and returns
 * its derived schedule. `null` means the card has never been reviewed.
 * `now` is accepted for a stable "as of" API; the result depends only
 * on the history, so two calls with the same events agree exactly.
 */
export function scheduleFor(
	cardId: string,
	reviews: readonly ReviewEvent[],
	now: Date
): Schedule | null {
	void now;

	const history = sortedReviews(reviews.filter((review) => review.payload.cardId === cardId));
	if (history.length === 0) return null;

	let card: Card = createEmptyCard(new Date(history[0].ts));
	for (const review of history) {
		card = scheduler.next(card, new Date(review.ts), RATING[review.payload.grade]).card;
	}

	return {
		due: card.due.toISOString(),
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
	now
}: BuildQueueOptions): StudyCard[] {
	const wanted = new Set(deckIds);
	const scoped = cards.filter((card) => card.deckIds.some((id) => wanted.has(id)));

	const historyByCard = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
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
		if (history === undefined) {
			fresh.push(card);
			continue;
		}
		const schedule = scheduleFor(card.id, history, now);
		if (schedule !== null && isDue(schedule, now)) {
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

/**
 * xpFromReviews awards 10 xp per review plus a grade bonus: Again and
 * Hard add nothing, Good 5, Easy 10.
 */
export function xpFromReviews(reviews: readonly ReviewEvent[]): number {
	return reviews.reduce(
		(total, review) => total + 10 + GRADE_BONUS[review.payload.grade],
		0
	);
}

/** levelFromXp maps 100 xp per level, starting at level 1. */
export function levelFromXp(xp: number): number {
	return Math.floor(xp / 100) + 1;
}
