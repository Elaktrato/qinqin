// The character map's level values and the scheme rule that puts a character in one level (owner request
// 2026-11-18). The map's grading, study set and Level focus are Stats' (#163, lib/stats/mapGrading.ts,
// lib/stats/mapView.ts). Pure helpers.

import type { CharRow } from '$lib/api/types';
import type { SchemeLevelMembers } from './charGroups';

export const LEVEL_ALL = 'all';

export interface LevelChoice {
	schemeId: number;
	levelId: number;
}

/** levelValue: the option value of one scheme level ("3:12"). */
export function levelValue(choice: LevelChoice): string {
	return `${choice.schemeId}:${choice.levelId}`;
}

/** parseLevelValue: the choice behind an option value, or null for "all" and junk. */
export function parseLevelValue(value: string): LevelChoice | null {
	const parts = value.split(':');
	if (parts.length !== 2) return null;
	const schemeId = Number(parts[0]);
	const levelId = Number(parts[1]);
	if (!Number.isSafeInteger(schemeId) || schemeId <= 0) return null;
	if (!Number.isSafeInteger(levelId) || levelId <= 0) return null;
	return { schemeId, levelId };
}

/**
 * levelOf returns the level a cell belongs to under the scheme grouping's
 * rule: its own glyph first, then a variant form, in level order (the first
 * level wins). Null when no level holds it.
 */
export function levelOf(
	row: CharRow,
	levels: readonly SchemeLevelMembers[]
): SchemeLevelMembers | null {
	for (const level of levels) if (level.chars.has(row.c)) return level;
	for (const form of row.v ?? []) {
		for (const level of levels) if (level.chars.has(form)) return level;
	}
	return null;
}
