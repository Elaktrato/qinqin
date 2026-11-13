// EXP, levels and streaks are derived from the review log, never stored.
// Day boundaries are UTC so every device agrees on what "today" is.

import type { ReviewEvent, ReviewGrade, StudyCardKind } from './types';

/** Base XP of one review by card kind. */
export const BASE_XP: Record<StudyCardKind, number> = {
	vocab: 10,
	sentence: 15,
	writing: 20,
	tone: 8
};

const GRADE_BONUS: Record<ReviewGrade, number> = { 1: 0, 2: 0, 3: 5, 4: 10 };

/** Bonus for the first review of each UTC day. */
const DAILY_BONUS = 10;

const DAY_MS = 86_400_000;

interface ValidReview {
	id: string;
	at: number;
	mode: StudyCardKind;
	grade: ReviewGrade;
}

function validReviews(reviews: readonly ReviewEvent[]): ValidReview[] {
	const out: ValidReview[] = [];
	for (const review of reviews) {
		if (review === null || typeof review !== 'object') continue;
		if (typeof review.ts !== 'string') continue;
		const at = Date.parse(review.ts);
		if (Number.isNaN(at)) continue;
		const payload: unknown = review.payload;
		if (typeof payload !== 'object' || payload === null) continue;
		const { cardId, grade, mode } = payload as { cardId?: unknown; grade?: unknown; mode?: unknown };
		if (typeof cardId !== 'string' || cardId.length === 0) continue;
		if (grade !== 1 && grade !== 2 && grade !== 3 && grade !== 4) continue;
		// Events from before kinds existed carry 'vocab'; an unknown mode
		// falls back to it rather than awarding NaN.
		const known = typeof mode === 'string' && Object.hasOwn(BASE_XP, mode);
		out.push({
			id: String(review.id),
			at,
			mode: known ? (mode as StudyCardKind) : 'vocab',
			grade
		});
	}
	return out;
}

function utcDay(at: number): number {
	return Math.floor(at / DAY_MS);
}

/**
 * xpFromReviews awards the kind's base XP plus a grade bonus per review,
 * and +10 for the first review of each UTC day. "First" is by timestamp,
 * then id, so the total never depends on the order events arrive in.
 */
export function xpFromReviews(reviews: readonly ReviewEvent[]): number {
	const valid = validReviews(reviews);
	let total = 0;
	for (const review of valid) {
		total += BASE_XP[review.mode] + GRADE_BONUS[review.grade];
	}
	// The bonus is flat, so it only depends on how many distinct days
	// have a review. Counting days keeps it order-independent by design.
	total += new Set(valid.map((review) => utcDay(review.at))).size * DAILY_BONUS;
	return total;
}

/** levelProgress: the cost of level L to L+1 is 100 * L xp. */
export function levelProgress(xp: number): { level: number; xpInto: number; xpForNext: number } {
	let remaining = Number.isFinite(xp) ? Math.max(0, Math.floor(xp)) : 0;
	let level = 1;
	while (remaining >= 100 * level) {
		remaining -= 100 * level;
		level += 1;
	}
	return { level, xpInto: remaining, xpForNext: 100 * level };
}

export function levelFromXp(xp: number): number {
	return levelProgress(xp).level;
}

/**
 * dailyStreak counts consecutive UTC days with a review. The current run
 * counts back from today, or from yesterday while today has none yet.
 */
export function dailyStreak(
	reviews: readonly ReviewEvent[],
	now: number
): { current: number; best: number; todayDone: boolean } {
	const days = [...new Set(validReviews(reviews).map((review) => utcDay(review.at)))].sort(
		(a, b) => a - b
	);
	const set = new Set(days);

	let best = 0;
	let run = 0;
	let prev: number | null = null;
	for (const day of days) {
		run = prev !== null && day === prev + 1 ? run + 1 : 1;
		best = Math.max(best, run);
		prev = day;
	}

	const today = utcDay(now);
	const todayDone = set.has(today);
	let cursor = todayDone ? today : today - 1;
	let current = 0;
	while (set.has(cursor)) {
		current += 1;
		cursor -= 1;
	}
	return { current, best, todayDone };
}
