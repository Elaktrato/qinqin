import type { Language, Workspace } from './api/types';

/** A language the UI can offer: its code and a human label. */
export interface LanguageInfo {
	code: string;
	label: string;
	/** True when dictionary data is installed for the language. */
	hasDictionary: boolean;
}

export type FlagKind = 'cn' | 'jp' | 'es' | 'globe';

const namesCache = new Map<string, Intl.DisplayNames | null>();

function displayNames(locale: string): Intl.DisplayNames | null {
	if (!namesCache.has(locale)) {
		let names: Intl.DisplayNames | null = null;
		try {
			names = new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' });
		} catch {
			names = null;
		}
		namesCache.set(locale, names);
	}
	return namesCache.get(locale) ?? null;
}

/** primarySubtag returns the lowercased language part of a code (`zh` of `zh-TW`). */
function primarySubtag(code: string): string {
	return code.trim().toLowerCase().split(/[-_]/)[0] ?? '';
}

/**
 * languageLabel names a language code for people (`ja` → "Japanese"),
 * via Intl.DisplayNames in `locale` (English by default, matching the
 * UI). Codes the runtime does not know, or malformed ones, come back
 * unchanged, so the label is never empty for a non-empty code.
 */
export function languageLabel(code: string, locale = 'en'): string {
	if (!code) return code;
	const names = displayNames(locale);
	if (!names) return code;
	try {
		const label = names.of(code.replace(/_/g, '-'));
		if (!label || label.toLowerCase() === code.toLowerCase()) return code;
		return label;
	} catch {
		return code;
	}
}

/** flagFor picks the hand-drawn flag for a language code; anything unknown gets a globe. */
export function flagFor(code: string): FlagKind {
	switch (primarySubtag(code)) {
		case 'zh':
			return 'cn';
		case 'ja':
			return 'jp';
		case 'es':
			return 'es';
		default:
			return 'globe';
	}
}

/** usesHan is true for languages written with Han characters (Chinese, Japanese). */
export function usesHan(code: string): boolean {
	const primary = primarySubtag(code);
	return primary === 'zh' || primary === 'ja';
}

/**
 * workspaceDisplay decides how a workspace appears next to its flag.
 * The single unnamed workspace of a language shows only the flag (and
 * the language label for screen readers). A name is shown when the
 * workspace has one, or when the user has two or more workspaces of
 * that language; unnamed ones are then called "<label>", "<label> 2", …
 * in list order.
 */
export function workspaceDisplay(
	list: readonly Workspace[],
	ws: Workspace
): { label: string; showName: boolean; name: string } {
	const label = languageLabel(ws.language);
	const own = ws.name.trim();
	const key = ws.language.toLowerCase();
	const sameLanguage = list.filter((other) => other.language.toLowerCase() === key);
	if (own) return { label, showName: true, name: own };
	if (sameLanguage.length < 2) return { label, showName: false, name: '' };

	const unnamed = sameLanguage.filter((other) => !other.name.trim());
	const position = unnamed.findIndex((other) => other.id === ws.id);
	const name = position <= 0 ? label : `${label} ${position + 1}`;
	return { label, showName: true, name };
}

/**
 * languageOptions lists the languages a new workspace may use: every
 * known language (GET /api/languages, flagged by whether a dictionary
 * is installed) plus the languages the user's workspaces already
 * use, deduplicated by code and sorted by label. Labels always come
 * from the code, never from the server's pack names.
 */
export function languageOptions(
	installed: readonly Language[],
	list: readonly Workspace[]
): LanguageInfo[] {
	const codes = new Map<string, LanguageInfo>();
	const entries = [
		...installed.map((lang) => ({ code: lang.code, hasDictionary: lang.installed })),
		...list.map((ws) => ({ code: ws.language, hasDictionary: false }))
	];
	for (const { code, hasDictionary } of entries) {
		const normalized = code.trim().toLowerCase();
		if (!normalized || codes.has(normalized)) continue;
		codes.set(normalized, { code: normalized, label: languageLabel(normalized), hasDictionary });
	}
	return [...codes.values()].sort(
		(a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || a.code.localeCompare(b.code)
	);
}
