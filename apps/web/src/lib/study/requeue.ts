// In-session re-show of Again cards, Anki learning-step style. Pure queue
// rules; the runner (study/session) owns the state. A re-show is practice
// only: its grade is never recorded, so FSRS, XP, streak and the review
// log see each card exactly once per original review.

import type { FlowItem } from './cardFlow';
import type { ReviewGrade, StudyCard } from './types';

/** Other cards shown between an Again and its re-show. */
export const REQUEUE_GAP = 4;

/** Re-shows one card may get in a session; a leech must not trap it. */
export const MAX_RESHOWS = 3;

/**
 * requeueAfterGrade returns the queue after the item at `index` was graded.
 * Only Again re-queues, after REQUEUE_GAP other cards or at the end when
 * fewer remain; later re-shows queue up behind earlier ones. A card has at
 * most one pending re-show and at most MAX_RESHOWS in total. `card` is the
 * real card (a virtual item has one once graded) the re-show points at.
 * The input is never mutated; the same array comes back when nothing changes.
 */
export function requeueAfterGrade(
	queue: readonly FlowItem[],
	index: number,
	grade: ReviewGrade,
	card?: StudyCard
): FlowItem[] {
	const current = queue[index];
	if (grade !== 1 || current === undefined) return queue as FlowItem[];
	const count = current.reshow ?? 0;
	if (count >= MAX_RESHOWS) return queue as FlowItem[];
	if (queue.slice(index + 1).some((other) => other.cardId === current.cardId)) return queue as FlowItem[];

	const again: FlowItem = {
		...current,
		virtual: false,
		card: card ?? current.card,
		reshow: count + 1
	};
	let at = Math.min(index + 1 + REQUEUE_GAP, queue.length);
	// First in, first out among re-shows that land on the same spot.
	while (at < queue.length && queue[at].reshow !== undefined) at += 1;
	return [...queue.slice(0, at), again, ...queue.slice(at)];
}

/** Whether grading this item writes a review (first pass only). */
export function reviewRecorded(item: FlowItem): boolean {
	return item.reshow === undefined;
}

export interface QueueProgress {
	/** Unique cards reached, counting the current one unless it is a re-show. */
	position: number;
	/** Unique cards in the session. */
	total: number;
	/** Re-shows still ahead, the current one included. */
	pending: number;
	/** The current item is a re-show. */
	reshowing: boolean;
}

/** progressOf counts unique cards; re-shows never grow the total. */
export function progressOf(queue: readonly FlowItem[], index: number): QueueProgress {
	let position = 0;
	let total = 0;
	let pending = 0;
	queue.forEach((item, i) => {
		if (item.reshow === undefined) {
			total += 1;
			if (i <= index) position += 1;
		} else if (i >= index) {
			pending += 1;
		}
	});
	return { position, total, pending, reshowing: queue[index]?.reshow !== undefined };
}

/** removeAt drops one position, leaving earlier items of the same card. */
export function removeAt(queue: readonly FlowItem[], index: number): FlowItem[] {
	return queue.filter((_, i) => i !== index);
}
