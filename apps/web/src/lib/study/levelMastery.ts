// "L of N learned" per level of a scheme. It reuses the Stats → Characters
// pipeline (buildSections, masteryGlyphs, cellStates, masteryForChars) so a
// level's count always agrees with the map: the best form of a glyph per
// cell (variants included), learned = score >= MASTERY_THRESHOLD.

import type { CharRow } from '$lib/api/types';
import {
	buildSections,
	cellStates,
	masteryGlyphs,
	sectionStats,
	type SchemeLevelMembers
} from './charGroups';
import { masteryForChars } from './mastery';
import type { ReviewEvent, StudyCard } from './types';

export interface LevelMasteryCount {
	learned: number;
	total: number;
}

/**
 * levelMastery scores the language's character rows in one pass and
 * counts, per level name, the cells of the level's section and how many
 * are learned. A level that has no row of the universe is 0 of 0.
 */
export function levelMastery(
	levels: readonly SchemeLevelMembers[],
	rows: readonly CharRow[],
	cards: readonly StudyCard[],
	reviews: readonly ReviewEvent[],
	now: Date,
	w: readonly number[]
): Map<string, LevelMasteryCount> {
	const mastery = masteryForChars(masteryGlyphs(rows), cards, reviews, now, w);
	const sections = buildSections(rows, 'scheme:0', levels);
	const bySection = new Map(sections.map((section) => [section.id, section]));
	const result = new Map<string, LevelMasteryCount>();
	for (const level of levels) {
		const section = bySection.get(`level-${level.levelId}`);
		if (section === undefined) {
			result.set(level.name, { learned: 0, total: 0 });
			continue;
		}
		const stats = sectionStats(cellStates(section.chars, mastery));
		result.set(level.name, { learned: stats.learned, total: stats.total });
	}
	return result;
}
