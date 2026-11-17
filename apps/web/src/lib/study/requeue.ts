// In-session re-show of Again cards, Anki learning-step style. Pure queue
// rules; the runner (study/session) owns the state. A re-show is practice
// only: its grade is never recorded, so FSRS, XP, streak and the review
// log see each card exactly once per original review.

import { t } from '$lib/i18n';
import type { FlowItem } from './cardFlow';
import type { ClozeMode } from './cloze';
import type { SaladTier } from './wordSalad';
import type { GradeItemResult } from './grade';
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
	card?: StudyCard,
	tier?: SaladTier,
	cloze?: { sentenceId: number; mode: ClozeMode }
): FlowItem[] {
	const current = queue[index];
	if (grade !== 1 || current === undefined) return queue as FlowItem[];
	const count = current.reshow ?? 0;
	if (count >= MAX_RESHOWS) return queue as FlowItem[];
	if (queue.slice(index + 1).some((other) => other.cardId === current.cardId)) return queue as FlowItem[];

	// Ruling: a failed last card is not repeated back to back; the re-show
	// needs at least one other card between, unless it is the only card.
	const last = index + 1 >= queue.length;
	if (last && queue.some((other) => other.cardId !== current.cardId)) return queue as FlowItem[];

	const realCard = card ?? current.card;
	const again: FlowItem = {
		...current,
		cardId: realCard?.id ?? current.cardId,
		virtual: false,
		card: realCard,
		reshow: count + 1,
		...(tier === undefined ? {} : { tier }),
		// A cloze re-show keeps the sentence and answer mode of its first showing.
		...(cloze === undefined ? {} : { clozeSentenceId: cloze.sentenceId, clozeMode: cloze.mode })
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

export type GradeStep =
	| { ok: false; error: string }
	| {
			ok: true;
			queue: FlowItem[];
			index: number;
			/** The gradeItem result when a review was recorded, null for a re-show. */
			recorded: Extract<GradeItemResult, { ok: true }> | null;
	  };

/**
 * applyGrade decides one grade: a first-pass item goes through `record`
 * (the injected gradeItem call, which writes the review) and may queue a
 * re-show; a re-show writes nothing and may queue another. A failed record
 * leaves queue and index untouched. The caller applies the returned state.
 */
export async function applyGrade(input: {
	queue: readonly FlowItem[];
	index: number;
	grade: ReviewGrade;
	tier?: SaladTier;
	/** The cloze sentence and mode of this showing; kept by a re-show. */
	cloze?: { sentenceId: number; mode: ClozeMode };
	record: () => Promise<GradeItemResult>;
}): Promise<GradeStep> {
	const { queue, index, grade, tier, cloze, record } = input;
	const item = queue[index];
	if (item === undefined) return { ok: false, error: t('study.grade.cardGone') };
	if (!reviewRecorded(item)) {
		return {
			ok: true,
			queue: requeueAfterGrade(queue, index, grade, undefined, tier, cloze),
			index: index + 1,
			recorded: null
		};
	}
	const result = await record();
	if (!result.ok) return { ok: false, error: result.error };
	return {
		ok: true,
		queue: requeueAfterGrade(queue, index, grade, result.card, tier, cloze),
		index: index + 1,
		recorded: result
	};
}
