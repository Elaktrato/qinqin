// Back in a study session (#131): the history of graded showings and what
// changing one grade does to the session. Pure; the session page owns the
// state. A recorded step is replaced by a new review naming it
// (study/events.ts recordReplacement, docs/contracts/events/
// review-replace.json); a practice step (a re-show) only edits the queue.

import type { FlowItem } from './cardFlow';
import { MAX_RESHOWS, REQUEUE_GAP } from './requeue';
import type { ReviewEvent, ReviewGrade } from './types';
import type { SaladTier } from './wordSalad';

/** Graded showings Back can reach (spec Ruling: bounded, more than anyone scrolls back). */
export const BACK_LIMIT = 20;

/** One graded showing of this session. `S` is what the page needs to show it again. */
export interface GradedStep<S = unknown> {
	/** Its queue position (shown positions never move: edits happen after the current card). */
	pos: number;
	/** The item as graded, with the real card of a virtual item once it was created. */
	item: FlowItem;
	grade: ReviewGrade;
	/** The exercise's suggestion, shown again. */
	suggested: ReviewGrade | null;
	/** When the card was finished: the interval preview's `now`. */
	finishedAt: number;
	/** The live recorded review (after a change: the replacement); null for practice. */
	review: ReviewEvent | null;
	/** The Word Salad tier of the showing; a re-show keeps it. */
	tier?: SaladTier;
	/** The page's resolved card, shown without replaying the exercise. */
	shown: S;
}

/** pushStep appends a graded showing, keeping the last BACK_LIMIT. */
export function pushStep<S>(steps: readonly GradedStep<S>[], step: GradedStep<S>): GradedStep<S>[] {
	return [...steps, step].slice(-BACK_LIMIT);
}

/**
 * backFrom is the step Back shows next: from the current card (null) the
 * last step, from a step the one before it, at the oldest step that one;
 * null when nothing was graded.
 */
export function backFrom(count: number, at: number | null): number | null {
	if (count === 0) return null;
	if (at === null) return count - 1;
	return Math.max(0, at - 1);
}

/** What choosing `grade` on a step does. */
export function regradeAction(step: GradedStep, grade: ReviewGrade): 'none' | 'replace' | 'queue' {
	if (grade === step.grade) return 'none';
	return step.review === null ? 'queue' : 'replace';
}

/**
 * regradeQueue undoes the queue effect of the step's old grade and applies
 * the new one, with `frontier` the current card's index. An Again's
 * pending re-show (at or after the current card) is removed; one already
 * shown stays. A new Again queues a re-show as requeueAfterGrade would
 * have at the card's own position, but never before the current card:
 * REQUEUE_GAP after it, FIFO behind other re-shows, none for a last card
 * while others exist, none beyond MAX_RESHOWS, none when the card already
 * appears after its position. The input is never mutated; the same array
 * comes back when nothing changes.
 */
export function regradeQueue(
	queue: readonly FlowItem[],
	frontier: number,
	step: GradedStep,
	grade: ReviewGrade
): FlowItem[] {
	const { item, pos } = step;
	const count = item.reshow ?? 0;
	let next = queue as FlowItem[];
	if (step.grade === 1 && grade !== 1) {
		const at = next.findIndex(
			(other, i) => i > pos && i >= frontier && other.cardId === item.cardId && other.reshow === count + 1
		);
		if (at >= 0) next = [...next.slice(0, at), ...next.slice(at + 1)];
	}
	if (grade !== 1 || step.grade === 1) return next;
	if (count >= MAX_RESHOWS) return next;
	if (next.slice(pos + 1).some((other) => other.cardId === item.cardId)) return next;
	const last = pos + 1 >= next.length;
	if (last && next.some((other) => other.cardId !== item.cardId)) return next;
	const again: FlowItem = {
		...item,
		virtual: false,
		reshow: count + 1,
		...(step.tier === undefined ? {} : { tier: step.tier })
	};
	let at = Math.max(Math.min(pos + 1 + REQUEUE_GAP, next.length), Math.min(frontier, next.length));
	while (at < next.length && next[at].reshow !== undefined) at += 1;
	return [...next.slice(0, at), again, ...next.slice(at)];
}

/** replaceSessionReview puts the replacement where the review `oldId` was. */
export function replaceSessionReview(
	reviews: readonly ReviewEvent[],
	oldId: string,
	next: ReviewEvent
): ReviewEvent[] {
	return reviews.map((review) => (review.id === oldId ? next : review));
}
