// What the mastery map shows under a pack grading (#163; docs/contracts/settings/mastery-map.json): the study set
// limits the map first (its levels; the characters outside the pack only while included), then the Level focus
// narrows within it (all study levels, one of them, or Outside). Pure, so the order of the two is tested.

import type { CharRow, Scheme } from '$lib/api/types';
import { t } from '$lib/i18n';
import type { SchemeLevelMembers, Section } from '$lib/studycore/charGroups';
import { LEVEL_ALL, levelOf, levelValue, parseLevelValue } from '$lib/studycore/charLevels';
import { studySet, type MasteryMapSettings } from './mapGrading';

/** The Level focus of the characters outside the grading. */
export const FOCUS_OUTSIDE = 'outside';

/** The id buildSections gives the characters in no level of a scheme. */
const OUTSIDE_SECTION = 'level-none';

export interface StudyLevel {
	levelId: number;
	ord: number;
	name: string;
}

export interface FocusOption {
	value: string;
	label: string;
}

/**
 * studyLevels: the pack's levels the map knows (those of the scheme list that the characters answer has, in level
 * order) and the study set among them (`studySet`: the stored ords, else every level).
 */
export function studyLevels(
	scheme: Scheme,
	members: readonly SchemeLevelMembers[],
	stored: MasteryMapSettings
): { all: StudyLevel[]; set: StudyLevel[] } {
	const loaded = new Set(members.map((m) => m.levelId));
	const all = [...scheme.levels]
		.sort((a, b) => a.ord - b.ord)
		.filter((level) => loaded.has(level.id))
		.map((level) => ({ levelId: level.id, ord: level.ord, name: level.name }));
	const ords = studySet(scheme.packId ?? '', all.map((level) => level.ord), stored);
	return { all, set: all.filter((level) => ords.includes(level.ord)) };
}

/**
 * mapChars: the characters the map shows. A character belongs to its level by the scheme rule (`levelOf`: its own
 * glyph first, then a variant, lowest level first); it is shown when that level is in the study set, or, in no level,
 * while the outside characters are included. Then the focus: every one of those, one level's, or the outside ones.
 */
export function mapChars(
	chars: readonly CharRow[],
	members: readonly SchemeLevelMembers[],
	setLevelIds: ReadonlySet<number>,
	includeOutside: boolean,
	focus: string
): CharRow[] {
	const choice = parseLevelValue(focus);
	return chars.filter((row) => {
		const level = levelOf(row, members);
		const inSet = level === null ? includeOutside : setLevelIds.has(level.levelId);
		if (!inSet) return false;
		if (focus === FOCUS_OUTSIDE) return level === null;
		if (choice !== null) return level?.levelId === choice.levelId;
		return true;
	});
}

/** outsideSectionLabel: "Outside HSK 3.0 (characters)". */
export function outsideSectionLabel(grading: string): string {
	return t('stats.map.slot.outside', { grading });
}

/** focusOptions: the Level select within the study set: all study levels, each one, and Outside while included. */
export function focusOptions(
	schemeId: number,
	set: readonly StudyLevel[],
	includeOutside: boolean,
	grading: string
): FocusOption[] {
	return [
		{ value: LEVEL_ALL, label: t('stats.map.level.all') },
		...set.map((level) => ({ value: levelValue({ schemeId, levelId: level.levelId }), label: level.name })),
		...(includeOutside ? [{ value: FOCUS_OUTSIDE, label: outsideSectionLabel(grading) }] : [])
	];
}

function storageKey(workspaceId: number): string {
	return `qinqin.map.level.${workspaceId}`;
}

/** readFocus: the remembered focus of a workspace while it is still offered, else all study levels. */
export function readFocus(storage: Storage | null, workspaceId: number, offered: readonly FocusOption[]): string {
	try {
		const stored = storage?.getItem(storageKey(workspaceId)) ?? null;
		return stored !== null && offered.some((o) => o.value === stored) ? stored : LEVEL_ALL;
	} catch {
		return LEVEL_ALL;
	}
}

/** writeFocus remembers the focus for one workspace (this device only); failures are ignored. */
export function writeFocus(storage: Storage | null, workspaceId: number, value: string): void {
	try {
		storage?.setItem(storageKey(workspaceId), value);
	} catch {
		// Private mode or denied storage: the focus lasts for this visit.
	}
}

/** withOutsideLabel names the section of the characters in no level after the grading. */
export function withOutsideLabel(sections: readonly Section[], grading: string): Section[] {
	return sections.map((s) => (s.id === OUTSIDE_SECTION ? { ...s, label: outsideSectionLabel(grading) } : s));
}
