// The character map's level filter (owner request 2026-11-18): "all levels"
// or one installed level scheme's level, remembered per workspace. Pure
// helpers, so the option list, the stored choice and the filter are tested
// without the page or the DOM.

import type { CharRow, Scheme } from '$lib/api/types';
import type { SchemeLevelMembers } from './charGroups';
import { isSampleScheme } from './charGroups';

export const LEVEL_ALL = 'all';

export interface LevelChoice {
	schemeId: number;
	levelId: number;
}

export interface LevelGroup {
	/** Stable key for the optgroup (the scheme id, not its display name). */
	id: string;
	label: string;
	options: { value: string; label: string }[];
}

function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
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
 * levelGroupsFor lists the installed level schemes of a language as optgroups
 * for the Level select, in scheme order and level order. The bundled samples
 * are hidden like the Group by list; `joyo-grades` stays, because "grade 3"
 * is a level a learner can study even though Grade already groups the map.
 * Schemes sharing a name are told apart by pack id.
 */
export function levelGroupsFor(language: string, schemes: readonly Scheme[]): LevelGroup[] {
	const lang = primarySubtag(language);
	const shown = schemes.filter(
		(scheme) =>
			primarySubtag(scheme.language) === lang && !isSampleScheme(scheme) && scheme.levels.length > 0
	);
	const named = new Map<string, number>();
	for (const scheme of shown) named.set(scheme.name, (named.get(scheme.name) ?? 0) + 1);
	return shown.map((scheme) => ({
		id: String(scheme.id),
		label:
			(named.get(scheme.name) ?? 0) > 1 && scheme.packId ? `${scheme.name} · ${scheme.packId}` : scheme.name,
		options: [...scheme.levels]
			.sort((a, b) => a.ord - b.ord)
			.map((level) => ({ value: levelValue({ schemeId: scheme.id, levelId: level.id }), label: level.name }))
	}));
}

function storageKey(workspaceId: number): string {
	return `qinqin.map.level.${workspaceId}`;
}

/**
 * readLevelChoice returns the remembered option value for a workspace when it
 * is still offered, else "all". Missing, stale and unreadable storage all mean
 * "all".
 */
export function readLevelChoice(
	storage: Storage | null,
	workspaceId: number,
	groups: readonly LevelGroup[]
): string {
	try {
		const stored = storage?.getItem(storageKey(workspaceId)) ?? null;
		const offered = groups.some((group) => group.options.some((option) => option.value === stored));
		return stored !== null && offered ? stored : LEVEL_ALL;
	} catch {
		return LEVEL_ALL;
	}
}

/** writeLevelChoice remembers the choice for one workspace; failures are ignored. */
export function writeLevelChoice(storage: Storage | null, workspaceId: number, value: string): void {
	try {
		storage?.setItem(storageKey(workspaceId), value);
	} catch {
		// Private mode or denied storage: the choice lasts for this visit.
	}
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

/**
 * filterByLevel keeps the cells the scheme grouping assigns to one level.
 * It uses `levelOf`, so a cell whose own glyph is in another level is not
 * pulled into a level that only holds one of its variants.
 */
export function filterByLevel(
	chars: readonly CharRow[],
	levels: readonly SchemeLevelMembers[],
	levelId: number
): CharRow[] {
	return chars.filter((row) => levelOf(row, levels)?.levelId === levelId);
}
