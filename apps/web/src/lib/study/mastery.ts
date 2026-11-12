// Mastery is derived, never stored: a character's score is the mean of
// the FSRS memory strength of every reviewed card whose written snapshot
// contains it. No extra event type and no per-character table — the same
// review history that schedules cards also feeds the map.

import { scheduleFor } from './scheduler';
import type { ReviewEvent, StudyCard } from './types';

/** The five bands the mastery map colours. */
export type MasteryStage = 'unknown' | 'fresh' | 'learning' | 'mature' | 'learned';

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

function stageOf(score: number): MasteryStage {
	if (score === 0) return 'unknown';
	if (score < 25) return 'fresh';
	if (score < 50) return 'learning';
	if (score < 80) return 'mature';
	return 'learned';
}

/**
 * masteryForChar scores one character across the reviewed vocab cards
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
	const strengths: number[] = [];

	for (const card of cards) {
		if (card.kind !== 'vocab') continue;
		if (card.written === undefined || !card.written.includes(char)) continue;
		const schedule = scheduleFor(card.id, reviews, now);
		if (schedule === null) continue;
		strengths.push(cardStrength(schedule.stability));
	}

	if (strengths.length === 0) {
		return { score: 0, stage: 'unknown', reviewedCards: 0 };
	}

	const mean = strengths.reduce((total, strength) => total + strength, 0) / strengths.length;
	const score = Math.round(100 * mean);
	return { score, stage: stageOf(score), reviewedCards: strengths.length };
}

/**
 * masterySummary counts how many of `chars` reach `threshold` (80 by
 * default, the `learned` band). It is the map's progress figure; the
 * denominator is every requested character, including unstudied ones.
 */
export function masterySummary(
	chars: readonly string[],
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date,
	threshold = 80
): MasterySummary {
	let mastered = 0;
	for (const char of chars) {
		if (masteryForChar(char, cards, reviews, now).score >= threshold) mastered += 1;
	}
	return { mastered, total: chars.length };
}
