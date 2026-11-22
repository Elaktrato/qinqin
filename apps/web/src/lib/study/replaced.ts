// Replaced reviews (#131, docs/contracts/events/review-replace.json). A
// changed grade is a new review naming the one it replaces; reviews that
// name each other form a family, and only the family's greatest id
// counts. Pure; applied once to the review log before anything counts.

import { isValidReview } from './scheduler';
import type { ReviewEvent } from './types';

/** The whole second of a review's instant: a link needs the same one. */
function secondOf(ts: string): number {
	return Math.floor(Date.parse(ts) / 1000);
}

/**
 * liveReviews drops every replaced review, keeping the input order (and
 * the objects). A review links to the one its `replaces` names when both
 * are valid, of the same workspace and card, in the same whole second;
 * any other reference is ignored. Invalid reviews pass through untouched
 * (the counters skip them). Returns the input array when nothing is
 * replaced.
 */
export function liveReviews<T extends ReviewEvent>(reviews: readonly T[]): T[] {
	const byId = new Map<string, T>();
	let linking = false;
	for (const review of reviews) {
		if (!isValidReview(review)) continue;
		byId.set(review.id, review);
		if (review.payload.replaces !== undefined) linking = true;
	}
	if (!linking) return reviews as T[];

	// Union-find over the links; the root of a family is its greatest id.
	const parent = new Map<string, string>();
	const find = (id: string): string => {
		let root = id;
		while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!;
		// Path compression.
		let at = id;
		while (at !== root) {
			const next = parent.get(at)!;
			parent.set(at, root);
			at = next;
		}
		return root;
	};
	const union = (a: string, b: string): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) return;
		if (ra > rb) parent.set(rb, ra);
		else parent.set(ra, rb);
	};
	for (const review of byId.values()) {
		const target = review.payload.replaces;
		if (target === undefined || target === review.id) continue;
		const other = byId.get(target);
		if (other === undefined) continue;
		if (other.workspaceId !== review.workspaceId) continue;
		if (other.payload.cardId !== review.payload.cardId) continue;
		if (secondOf(other.ts) !== secondOf(review.ts)) continue;
		union(review.id, other.id);
	}
	if (parent.size === 0) return reviews as T[];
	return reviews.filter((review) => !byId.has(review.id) || find(review.id) === review.id);
}
