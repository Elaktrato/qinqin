// Which review events count and in what order they replay: the two rules
// every derivation (schedules, day counts, limits) starts from. A leaf
// module, so limits.ts need not import the scheduler (#175). Rules:
// docs/contracts/events/ (review parsing and replay order).

import type { ReviewEvent } from './types';

/** An RFC 3339 instant in epoch ms; 0 for an unparsable one. */
export function instantOf(ts: string): number {
	const ms = Date.parse(ts);
	return Number.isNaN(ms) ? 0 : ms;
}

/** Ascending by `id` (plain string order). */
export function compareById(a: { id: string }, b: { id: string }): number {
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

/**
 * sortedReviews orders a card's history by event time, then by id so
 * two events written in the same millisecond still replay in the same
 * order on every device.
 */
export function sortedReviews(reviews: readonly ReviewEvent[]): ReviewEvent[] {
	return [...reviews].sort((a, b) => instantOf(a.ts) - instantOf(b.ts) || compareById(a, b));
}
