import type { Dictionary, Scheme } from '$lib/api/types';
import { t } from '$lib/i18n';

/**
 * coverage tells what a language has installed: its dictionaries and the
 * number of level schemes. Codes match case-insensitively and in full.
 */
export function coverage(
	language: string,
	dictionaries: readonly Dictionary[],
	schemes: readonly Scheme[]
): { dictionaries: Dictionary[]; levels: number } {
	const key = language.trim().toLowerCase();
	return {
		dictionaries: dictionaries.filter((d) => d.language.toLowerCase() === key),
		levels: schemes.filter((s) => s.language.toLowerCase() === key).length
	};
}

/** dictionaryHint explains a language without a dictionary and the next step. */
export function dictionaryHint(label: string, admin: boolean): string {
	return admin
		? t('search.coverage.noDictionaryAdmin', { language: label })
		: t('search.coverage.noDictionary', { language: label });
}

/** levelsHint explains a language without level lists. */
export function levelsHint(label: string): string {
	return t('search.coverage.noLevels', { language: label });
}
