// "L of N learned" per level of a scheme: the Stats → Characters
// definition (stage `learned`, score ≥ MASTERY_THRESHOLD), no new formula.

import type { SchemeLevelMembers } from './charGroups';
import { masteryForChars } from './mastery';
import type { ReviewEvent, StudyCard } from './types';

export interface LevelMasteryCount {
	learned: number;
	total: number;
}

/**
 * levelMastery scores the union of every level's characters in one
 * `masteryForChars` pass and counts, per level name, how many are
 * learned. A level's characters are a Set, so duplicates count once.
 */
export function levelMastery(
	levels: readonly SchemeLevelMembers[],
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[]
): Map<string, LevelMasteryCount> {
	const union = new Set<string>();
	for (const level of levels) for (const char of level.chars) union.add(char);
	const mastery = masteryForChars([...union], cards, reviews, now, w);
	const result = new Map<string, LevelMasteryCount>();
	for (const level of levels) {
		let learned = 0;
		for (const char of level.chars) {
			if (mastery.get(char)?.stage === 'learned') learned += 1;
		}
		result.set(level.name, { learned, total: level.chars.size });
	}
	return result;
}
