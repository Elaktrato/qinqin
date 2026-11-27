// The mastery map's grading (#163; docs/contracts/settings/mastery-map.json): the workspace-settings key
// `masteryMap` = {grading, includeOutside, levels}. One grading per workspace: a built-in grouping of the language
// or one installed level pack (`pack:<packId>`); by default HSK (Chinese) or JLPT (Japanese), else today's grouping.
// With a pack grading the map shows only the pack's characters unless `includeOutside`, and only the levels of the
// pack's study set (`levels[packId]`, level ords; absent = every level). Pure, so the rule is tested on the fixture.

import type { Scheme } from '$lib/api/types';
import { groupOptions, type GroupKey } from '$lib/studycore/charGroups';

export const MASTERY_MAP_KEY = 'masteryMap';

export interface MasteryMapSettings {
	/** The stored grading, null when absent or not a grading (the default applies). */
	grading: string | null;
	includeOutside: boolean;
	/** The study set per pack id: level ords, each once, in the stored order. */
	levels: Record<string, number[]>;
}

export interface GradingOption {
	/** The stored value: a built-in key or `pack:<packId>`. */
	value: string;
	label: string;
	/** The map's grouping key (`scheme:<id>` for a pack). */
	groupKey: GroupKey;
	/** The pack's scheme (null for a built-in grouping). */
	scheme: Scheme | null;
}

const BUILT_IN = new Set(['grade', 'freq', 'strokes', 'common', 'hkgrade']);
const PACK = 'pack:';

/** The default packs of a language, in preference order, then the prefix any other default pack starts with. */
const DEFAULT_PACKS: Readonly<Record<string, readonly string[]>> = { ja: ['jlpt-kanji'], zh: ['hsk-chars', 'hsk-words'] };
const DEFAULT_PREFIX: Readonly<Record<string, string>> = { ja: 'jlpt-', zh: 'hsk-' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

function isGrading(value: unknown): value is string {
	return typeof value === 'string' && (BUILT_IN.has(value) || (value.startsWith(PACK) && value.length > PACK.length));
}

function readOrds(value: unknown): number[] | null {
	if (!Array.isArray(value)) return null;
	const out: number[] = [];
	for (const item of value) {
		if (typeof item === 'number' && Number.isInteger(item) && item >= 0 && !out.includes(item)) out.push(item);
	}
	return out.length > 0 ? out : null;
}

/** readMasteryMap reads `settings.masteryMap`, each member alone (an absent or invalid one is the default). */
export function readMasteryMap(settings: Record<string, unknown> | null | undefined): MasteryMapSettings {
	const stored = settings?.[MASTERY_MAP_KEY];
	const root = isObject(stored) ? stored : {};
	const levels: Record<string, number[]> = {};
	if (isObject(root.levels)) {
		for (const [pack, value] of Object.entries(root.levels)) {
			const ords = pack === '' ? null : readOrds(value);
			if (ords !== null) levels[pack] = ords;
		}
	}
	return {
		grading: isGrading(root.grading) ? root.grading : null,
		includeOutside: root.includeOutside === true,
		levels
	};
}

/**
 * gradingOptions: what the map can go by in a language: its built-in groupings, then each installed level pack of
 * the language (the samples and the Jōyō pack, which is the built-in Grade, never; charGroups.groupOptions).
 */
export function gradingOptions(language: string, schemes: readonly Scheme[]): GradingOption[] {
	const byId = new Map(schemes.map((s) => [s.id, s]));
	return groupOptions(language, schemes).flatMap((option): GradingOption[] => {
		if (!option.key.startsWith('scheme:')) return [{ value: option.key, label: option.label, groupKey: option.key, scheme: null }];
		const scheme = byId.get(Number(option.key.slice('scheme:'.length)));
		if (scheme?.packId === undefined || scheme.packId === '') return [];
		return [{ value: `${PACK}${scheme.packId}`, label: option.label, groupKey: option.key, scheme }];
	});
}

/**
 * resolveGrading: the grading the map goes by: the stored one when the language offers it, else the default (the
 * first installed default pack, else a pack with the default prefix, else the first built-in). Null for a language
 * without a character map.
 */
export function resolveGrading(language: string, schemes: readonly Scheme[], stored: MasteryMapSettings): string | null {
	const options = gradingOptions(language, schemes);
	if (options.length === 0) return null;
	if (stored.grading !== null && options.some((o) => o.value === stored.grading)) return stored.grading;
	const lang = primarySubtag(language);
	const packs = options.filter((o) => o.scheme !== null);
	for (const id of DEFAULT_PACKS[lang] ?? []) {
		if (packs.some((o) => o.value === `${PACK}${id}`)) return `${PACK}${id}`;
	}
	const prefix = DEFAULT_PREFIX[lang];
	const prefixed = prefix === undefined ? undefined : packs.find((o) => o.value.startsWith(`${PACK}${prefix}`));
	return prefixed?.value ?? options[0].value;
}

/** packOf: the pack id of a `pack:` grading, else null. */
export function packOf(grading: string | null): string | null {
	return grading !== null && grading.startsWith(PACK) ? grading.slice(PACK.length) : null;
}

/**
 * studySet: the level ords of a pack the map shows, in level order (`ords` are the pack's installed levels in order):
 * the stored set's installed levels, or every level when nothing (or nothing installed) is stored.
 */
export function studySet(pack: string, ords: readonly number[], stored: MasteryMapSettings): number[] {
	const set = stored.levels[pack];
	const kept = set === undefined ? [] : ords.filter((ord) => set.includes(ord));
	return kept.length > 0 ? kept : [...ords];
}

/** gradingPatch: the merge patch that chooses a grading. */
export function gradingPatch(grading: string): Record<string, unknown> {
	return { [MASTERY_MAP_KEY]: { grading } };
}

/** includeOutsidePatch: the merge patch of the "Include characters outside" switch. */
export function includeOutsidePatch(includeOutside: boolean): Record<string, unknown> {
	return { [MASTERY_MAP_KEY]: { includeOutside } };
}

/** studyLevelsPatch: the merge patch of a pack's study set, in level order; every level deletes the set (null). */
export function studyLevelsPatch(pack: string, levels: readonly number[], ords: readonly number[]): Record<string, unknown> {
	const kept = ords.filter((ord) => levels.includes(ord));
	const every = ords.every((ord) => kept.includes(ord));
	return { [MASTERY_MAP_KEY]: { levels: { [pack]: every ? null : kept } } };
}
