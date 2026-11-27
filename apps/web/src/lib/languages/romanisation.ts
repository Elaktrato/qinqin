// Hidden romanisation (#284; docs/contracts/settings/romanisation.json): a learner may never see romaji
// (Japanese), pinyin or bopomofo (Chinese), each on its own, per workspace (the workspace-settings key
// `romanisation`). The server keeps sending every reading; the client hides them. ONE rule decides on every
// screen: `isReadingShown`. Components do not call it directly: they use `useRomanisation()`
// (./useRomanisation.ts) or `ReadingText`, which read the current workspace; the guard
// (romanisation.lint.test.ts) fails a component that renders a reading field without them.

import { profileOf } from './profiles';

export const ROMANISATION_TYPES = ['pinyin', 'bopomofo', 'romaji'] as const;
export type RomanisationType = (typeof ROMANISATION_TYPES)[number];

export const ROMANISATION_MODES = ['always', 'never'] as const;
export type RomanisationMode = (typeof ROMANISATION_MODES)[number];

/** The mode of every romanisation type. */
export type Romanisation = Record<RomanisationType, RomanisationMode>;

/** The workspace-settings key (docs/contracts/settings/workspace-settings.json). */
export const ROMANISATION_KEY = 'romanisation';

export const ROMANISATION_DEFAULTS: Readonly<Romanisation> = { pinyin: 'always', bopomofo: 'always', romaji: 'always' };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMode = (v: unknown): v is RomanisationMode => v === 'always' || v === 'never';

/** isRomanisationType: the (trimmed, lower-cased) reading type is one with a Show switch. */
export function isRomanisationType(type: string): type is RomanisationType {
	return (ROMANISATION_TYPES as readonly string[]).includes(type);
}

/** readRomanisation reads `settings.romanisation`: each member alone, an absent or invalid one is `always`. */
export function readRomanisation(settings: Record<string, unknown> | null | undefined): Romanisation {
	const stored = settings?.[ROMANISATION_KEY];
	const root = isObject(stored) ? stored : {};
	const out = { ...ROMANISATION_DEFAULTS };
	for (const type of ROMANISATION_TYPES) {
		const value = root[type];
		if (isMode(value)) out[type] = value;
	}
	return out;
}

/**
 * isReadingShown: THE rule. A reading of `type` is shown unless it is a romanisation whose mode is `never`. Kana,
 * on, kun and pack-defined types are always shown.
 */
export function isReadingShown(type: string, prefs: Readonly<Romanisation>): boolean {
	const key = type.trim().toLowerCase();
	return !isRomanisationType(key) || prefs[key] !== 'never';
}

/** shownReadings: the readings the learner sees, in their order. */
export function shownReadings<T extends { type: string }>(readings: readonly T[], prefs: Readonly<Romanisation>): T[] {
	return readings.filter((r) => isReadingShown(r.type, prefs));
}

/** hiddenReadings: the readings the setting hides (what the romanisation hint reveals), in their order. */
export function hiddenReadings<T extends { type: string }>(readings: readonly T[], prefs: Readonly<Romanisation>): T[] {
	return readings.filter((r) => !isReadingShown(r.type, prefs));
}

/** romanisationsOf: the romanisation types of a language (its profile), the switches Settings shows. */
export function romanisationsOf(language: string): RomanisationType[] {
	return profileOf(language).romanisations.filter(isRomanisationType);
}

const BOPOMOFO = /[㄀-ㄯㆠ-ㆿ]/u;
const LATIN = /\p{Script=Latin}/u;

/**
 * readingTypeOfText types a reading the server sends as a plain string (a word list's reading, a sentence's
 * reading line, a book's ruby) by its script: Bopomofo letters are `bopomofo`; Latin letters are the language's
 * Latin romanisation (`pinyin` in Chinese, `romaji` in Japanese); anything else (kana, hanzi) is not
 * romanisation (null).
 */
export function readingTypeOfText(text: string, language: string): RomanisationType | null {
	const types = romanisationsOf(language);
	if (text === '' || types.length === 0) return null;
	if (BOPOMOFO.test(text)) return types.includes('bopomofo') ? 'bopomofo' : null;
	if (LATIN.test(text)) return types.find((t) => t !== 'bopomofo') ?? null;
	return null;
}

/** isReadingTextShown: the rule for a reading string without a type (typed by its script). */
export function isReadingTextShown(text: string, language: string, prefs: Readonly<Romanisation>): boolean {
	const type = readingTypeOfText(text, language);
	return type === null || isReadingShown(type, prefs);
}

/** romanisationPatch: the merge patch (settings contract) that sets one type. */
export function romanisationPatch(type: RomanisationType, mode: RomanisationMode): Record<string, unknown> {
	return { [ROMANISATION_KEY]: { [type]: mode } };
}
