// Mastery is derived, never stored: a character's score is the mean of
// the FSRS memory strength of every reviewed card whose written snapshot
// contains it. No extra event type and no per-character table — the same
// review history that schedules cards also feeds the map.

import { scheduleFor } from './scheduler';
import type { ReviewEvent, StudyCard } from './types';

/** The five bands the mastery map colours. */
export type MasteryStage = 'unknown' | 'fresh' | 'learning' | 'mature' | 'learned';

/**
 * The lower edge of the `learned` band: a character at or above this
 * score counts as mastered. The single source for every consumer.
 */
export const MASTERY_THRESHOLD = 80;

export interface CharMastery {
	/** 0–100, the rounded mean of the per-card strength. */
	score: number;
	stage: MasteryStage;
	/** Reviewed cards whose written form contains the character. */
	reviewedCards: number;
}

export interface MasterySummary {
	mastered: number;
	total: number;
}

// A year of stability is the ceiling: the formula reaches 1.0 there.
const MAX_STABILITY_DAYS = 365;
const MAX_LOG = Math.log2(1 + MAX_STABILITY_DAYS);

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * cardStrength maps FSRS stability in days to 0–1 on a log scale, so a
 * card that holds for a year counts fully and doubling the stability
 * always adds the same amount.
 */
function cardStrength(stability: number): number {
	if (!Number.isFinite(stability)) return 0;
	return clamp01(Math.log2(1 + Math.max(0, stability)) / MAX_LOG);
}

/**
 * stageOf maps a 0–100 score to its colour band. Zero is its own band:
 * no reviewed card means "unknown" rather than a weak "fresh".
 */
export function stageOf(score: number): MasteryStage {
	if (score === 0) return 'unknown';
	if (score < 25) return 'fresh';
	if (score < 50) return 'learning';
	if (score < MASTERY_THRESHOLD) return 'mature';
	return 'learned';
}

function unknownMastery(): CharMastery {
	return { score: 0, stage: 'unknown', reviewedCards: 0 };
}

/**
 * groupReviewsByCard buckets the valid-looking reviews once. It only
 * reads the payload far enough to key the bucket; `scheduleFor` still
 * rejects malformed grades and timestamps when it replays a card's
 * history.
 */
function groupReviewsByCard(reviews: readonly ReviewEvent[]): Map<string, ReviewEvent[]> {
	const byCard = new Map<string, ReviewEvent[]>();
	for (const review of reviews) {
		if (review === null || typeof review !== 'object') continue;
		const payload: unknown = review.payload;
		if (typeof payload !== 'object' || payload === null) continue;
		const { cardId } = payload as { cardId?: unknown };
		if (typeof cardId !== 'string' || cardId.length === 0) continue;
		const history = byCard.get(cardId);
		if (history === undefined) {
			byCard.set(cardId, [review]);
		} else {
			history.push(review);
		}
	}
	return byCard;
}

/**
 * masteryForChars scores many characters in one pass: reviews are
 * bucketed by card once, each reviewed card's FSRS schedule is replayed
 * once, and its strength is added to every character in its written
 * snapshot. The map holds an entry for every requested character,
 * including characters no reviewed card contains. An empty string is
 * never matched — `written.includes('')` would otherwise make every
 * string contain it.
 *
 * This is the map page's entry point: the per-character API delegates
 * here, so its results and the batch's agree by construction.
 */
export function masteryForChars(
	chars: readonly string[],
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date
): Map<string, CharMastery> {
	const wanted = new Set(chars.filter((char) => char.length > 0));
	const totals = new Map<string, { sum: number; count: number }>();
	for (const char of wanted) {
		totals.set(char, { sum: 0, count: 0 });
	}

	if (wanted.size > 0) {
		const reviewsByCard = groupReviewsByCard(reviews);

		for (const card of cards) {
			const written = card.written;
			if (written === undefined || written === '') continue;
			const history = reviewsByCard.get(card.id);
			// No history means no schedule; skipping avoids a replay that
			// would only return null.
			if (history === undefined) continue;
			const schedule = scheduleFor(card.id, history, now);
			if (schedule === null) continue;

			const strength = cardStrength(schedule.stability);
			// A written form may repeat a character; the card still counts
			// once for it, matching the per-card mean.
			for (const char of new Set(Array.from(written))) {
				const total = totals.get(char);
				if (total === undefined) continue;
				total.sum += strength;
				total.count += 1;
			}
		}
	}

	const mastery = new Map<string, CharMastery>();
	for (const char of chars) {
		const total = char.length === 0 ? undefined : totals.get(char);
		if (total === undefined || total.count === 0) {
			mastery.set(char, unknownMastery());
			continue;
		}
		const score = Math.round((100 * total.sum) / total.count);
		mastery.set(char, { score, stage: stageOf(score), reviewedCards: total.count });
	}
	return mastery;
}

/**
 * masteryForChar scores one character across the reviewed cards of any kind
 * whose written snapshot contains it. Cards without a snapshot are
 * legacy rows: the map resolver supplies their written forms separately,
 * so they cannot contribute here. A card with no valid review has no
 * stability and is skipped, which makes an unreviewed card invisible to
 * the average. `scheduleFor` already ignores malformed reviews.
 */
export function masteryForChar(
	char: string,
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date
): CharMastery {
	return masteryForChars([char], cards, reviews, now).get(char) ?? unknownMastery();
}

/**
 * summarizeMastery counts how many of `chars` reach `threshold` (80 by
 * default, the `learned` band) using an already-computed mastery map.
 * The map's grid, its selection figure, and every level's progress line
 * can therefore share one masteryForChars pass over the union of all
 * scheme characters instead of replaying the review history per level.
 */
export function summarizeMastery(
	chars: readonly string[],
	mastery: ReadonlyMap<string, CharMastery>,
	threshold = MASTERY_THRESHOLD
): MasterySummary {
	let mastered = 0;
	for (const char of chars) {
		if ((mastery.get(char)?.score ?? 0) >= threshold) mastered += 1;
	}
	return { mastered, total: chars.length };
}

/**
 * masterySummary counts how many of `chars` reach `threshold` (80 by
 * default, the `learned` band). It is the one-shot progress figure; the
 * denominator is every requested character, including unstudied ones.
 * It scores `chars` in a single pass and delegates the counting to
 * summarizeMastery.
 */
export function masterySummary(
	chars: readonly string[],
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date,
	threshold = MASTERY_THRESHOLD
): MasterySummary {
	return summarizeMastery(chars, masteryForChars(chars, cards, reviews, now), threshold);
}
