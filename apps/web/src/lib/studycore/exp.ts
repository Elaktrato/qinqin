// EXP, levels and streaks are derived from the review log, never stored.
// Day boundaries are the learner's day (lib/time/studyDay.ts), recomputed
// for the whole log, so every device agrees on what "today" is.

import { addDays, type StudyDay } from '$lib/time/studyDay';
import { isVacationDay, type Run } from './vacation';
import type { ReviewEvent, ReviewGrade, StudyCardKind } from './types';

/** Base XP of one review by card kind. */
export const BASE_XP: Record<StudyCardKind, number> = {
	vocab: 10,
	sentence: 15,
	writing: 20,
	tone: 8,
	reverse: 10,
	cloze: 15
};

export const GRADE_BONUS: Record<ReviewGrade, number> = { 1: 0, 2: 0, 3: 5, 4: 10 };

/** Bonus for the first review of each learner day. */
export const DAILY_BONUS = 10;

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

/**
 * xpFromReviews awards the kind's base XP plus a grade bonus per review,
 * and a flat +10 for every distinct learner day that has at least one
 * review (`dayOf` maps an instant in ms to its day, StudyDay.dayOf). Only
 * the day count matters, so the total never depends on event order.
 */
export function xpFromReviews(
	reviews: readonly ReviewEvent[],
	dayOf: (ms: number) => string
): number {
	const valid = validReviews(reviews);
	let total = 0;
	for (const review of valid) {
		total += BASE_XP[review.mode] + GRADE_BONUS[review.grade];
	}
	// The bonus is flat, so it only depends on how many distinct days
	// have a review. Counting days keeps it order-independent by design.
	total += new Set(valid.map((review) => dayOf(review.at))).size * DAILY_BONUS;
	return total;
}

/**
 * xpByKind splits the per-review XP (base plus grade bonus) by card kind.
 * The daily bonus belongs to no kind and is left out; callers can derive
 * it as xpFromReviews minus the sum of these.
 */
export function xpByKind(reviews: readonly ReviewEvent[]): Record<StudyCardKind, number> {
	const out: Record<StudyCardKind, number> = {
		vocab: 0,
		sentence: 0,
		writing: 0,
		tone: 0,
		reverse: 0,
		cloze: 0
	};
	for (const review of validReviews(reviews)) {
		out[review.mode] += BASE_XP[review.mode] + GRADE_BONUS[review.grade];
	}
	return out;
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

/** The nearest date before `d` that is not a vacation day. */
function dateBefore(d: string, onVacation: (d: string) => boolean): string {
	let c = addDays(d, -1);
	for (let guard = 0; onVacation(c) && guard < 100_000; guard++) c = addDays(c, -1);
	return c;
}

/**
 * streakRuns gives, for each review date (sorted, distinct, no vacation
 * dates), the length of the run it ends: a run continues when the nearest
 * non-vacation date before a date is the previous review date (vacation
 * days are neutral). dailyStreak's best run is the maximum; the milestones
 * read the day each length is first reached.
 */
export function streakRuns(days: readonly string[], vacation: readonly Run[]): number[] {
	const onVacation = (d: string): boolean => isVacationDay(vacation, d);
	const out: number[] = [];
	let run = 0;
	let prev: string | null = null;
	for (const d of days) {
		run = prev !== null && dateBefore(d, onVacation) === prev ? run + 1 : 1;
		out.push(run);
		prev = d;
	}
	return out;
}

/**
 * dailyStreak counts consecutive learner days with a review (civil dates,
 * so a 23 or 25 hour day is one day). The current run counts back from
 * today, or from yesterday while today has none yet. Days after `now`
 * (clock skew, a device set ahead) are ignored for both the current run
 * and the best run.
 */
export function dailyStreak(
	reviews: readonly ReviewEvent[],
	now: number,
	day: StudyDay,
	vacation: readonly Run[] = []
): { current: number; best: number; todayDone: boolean } {
	const today = day.today(now);
	const onVacation = (d: string): boolean => isVacationDay(vacation, d);
	// Vacation days are neutral: they neither extend nor break a run, and a
	// review on one does not count (docs/contracts/scheduler/).
	const days = [
		...new Set(
			validReviews(reviews)
				.map((review) => day.dayOf(review.at))
				.filter((d) => d <= today && !onVacation(d))
		)
	].sort();
	const set = new Set(days);
	const best = streakRuns(days, vacation).reduce((a, b) => (b > a ? b : a), 0);

	const todayVacation = onVacation(today);
	const todayDone = todayVacation || set.has(today);
	let cursor = set.has(today) ? today : dateBefore(today, onVacation);
	let current = 0;
	while (set.has(cursor)) {
		current += 1;
		cursor = dateBefore(cursor, onVacation);
	}
	return { current, best, todayDone };
}
