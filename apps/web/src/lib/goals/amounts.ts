// Per learner day amounts a daily goal is measured by: new cards and capped
// answer time from the local review log, and the activity cells the server
// returns for one workspace. Pure. Rule and fixtures: docs/contracts/goals/.

import type { ActivityCell } from '../api/stats';
import { isValidReview, sortedReviews } from '../study/scheduler';
import type { ReviewEvent } from '../study/types';

/** Answer time counted per review at most (an idle tab is not an hour of study). */
export const MAX_REVIEW_MS = 60_000;

export interface DayAmounts {
	/** The cell `raw` per activity type: a count, or clamped seconds. */
	activity: Readonly<Record<string, number>>;
	newCards: number;
	studySeconds: number;
}

export const NO_AMOUNTS: DayAmounts = Object.freeze({
	activity: Object.freeze({}),
	newCards: 0,
	studySeconds: 0
});

export interface FlashcardDay {
	newCards: number;
	studySeconds: number;
}

function answerMs(review: ReviewEvent): number {
	const ms: unknown = review.payload.meta?.durationMs;
	if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return 0;
	return Math.min(ms, MAX_REVIEW_MS);
}

/** New cards (first valid review per cardId) and capped answer time, per learner day. */
export function flashcardAmounts(
	reviews: readonly ReviewEvent[],
	dayOf: (ms: number) => string
): Map<string, FlashcardDay> {
	const valid = sortedReviews(reviews.filter(isValidReview));
	const ms = new Map<string, number>();
	const fresh = new Map<string, number>();
	const seen = new Set<string>();
	for (const review of valid) {
		const day = dayOf(Date.parse(review.ts));
		ms.set(day, (ms.get(day) ?? 0) + answerMs(review));
		if (!seen.has(review.payload.cardId)) {
			seen.add(review.payload.cardId);
			fresh.set(day, (fresh.get(day) ?? 0) + 1);
		}
	}
	const out = new Map<string, FlashcardDay>();
	for (const day of [...ms.keys()].sort()) {
		out.set(day, { newCards: fresh.get(day) ?? 0, studySeconds: (ms.get(day) ?? 0) / 1000 });
	}
	return out;
}

/** The `raw` of each type per day for one workspace; other workspaces ignored. */
export function activityAmounts(
	cells: readonly ActivityCell[],
	workspaceId: number
): Map<string, Record<string, number>> {
	const out = new Map<string, Record<string, number>>();
	for (const cell of cells) {
		if (cell.workspace !== workspaceId || typeof cell.raw !== 'number' || !Number.isFinite(cell.raw)) continue;
		let day = out.get(cell.day);
		if (day === undefined) {
			day = {};
			out.set(cell.day, day);
		}
		day[cell.type] = (day[cell.type] ?? 0) + cell.raw;
	}
	return out;
}

/** amountsOf joins both sources into one lookup per learner day. */
export function amountsOf(
	flash: ReadonlyMap<string, FlashcardDay>,
	activity: ReadonlyMap<string, Record<string, number>>
): (day: string) => DayAmounts {
	return (day) => {
		const f = flash.get(day);
		const a = activity.get(day);
		if (f === undefined && a === undefined) return NO_AMOUNTS;
		return { activity: a ?? {}, newCards: f?.newCards ?? 0, studySeconds: f?.studySeconds ?? 0 };
	};
}
