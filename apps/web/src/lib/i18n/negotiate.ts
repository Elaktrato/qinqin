// Interface-language negotiation, the formatting locale and the stored setting's syntax (issue #73,
// docs/contracts/i18n/README.md "Interface language"; fixtures negotiate.json, language-tags.json). A small written
// algorithm, identical in TS, Kotlin and Go, instead of a matcher's distance tables (spec Ruling).

export const DEFAULT_LANGUAGE = 'en';

const SETTING = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$/;

const CATALOGUE_FILE = /^\.\/messages\/([^/]+)\.json$/;

/**
 * The interface languages of a set of catalogue files (`./messages/<tag>.json`): every file named by a language tag
 * (`notes.json` is not one), `en` first (the source catalogue, always there), the others sorted (#297).
 */
export function catalogueLanguages(files: readonly string[]): string[] {
	const tags = new Set<string>();
	for (const file of files) {
		const tag = CATALOGUE_FILE.exec(file)?.[1];
		if (tag !== undefined && tag !== DEFAULT_LANGUAGE && SETTING.test(tag)) tags.add(tag);
	}
	return [DEFAULT_LANGUAGE, ...[...tags].sort()];
}

/**
 * The interface languages with a catalogue: the files in `messages/` (#297). Adding `messages/de.json` makes German
 * negotiable, and selectable in Settings, with no other change.
 */
export const SUPPORTED_LANGUAGES: readonly string[] = catalogueLanguages(
	// The same pattern as index.ts's lazy loaders (en is in the main bundle; notes.json is for translators), so the
	// build makes no extra chunk.
	Object.keys(import.meta.glob(['./messages/*.json', '!./messages/en.json', '!./messages/notes.json']))
);

/**
 * The format locale of English without a region: day before month ("16 November 2026", 24-hour times), the English
 * the interface has always written (docs/contracts/i18n/README.md, Interface language). Also the fallback for a
 * locale the platform cannot resolve.
 */
export const DEFAULT_FORMAT_LOCALE = 'en-GB';

/** The stored interface-language setting: `''` (follow the browser) or a canonical-case tag. Syntax only. */
export function isLanguageSetting(value: unknown): value is string {
	return typeof value === 'string' && (value === '' || SETTING.test(value));
}

const isScript = (s: string): boolean => /^[a-z]{4}$/i.test(s);
const isRegion = (s: string): boolean => /^(?:[a-z]{2}|[0-9]{3})$/i.test(s);

/** The lookup chain of one candidate: itself, the zh script form, then trailing subtags dropped. */
function chain(candidate: string): string[] {
	const out = [candidate];
	let parts = candidate.split('-');
	if (parts[0].toLowerCase() === 'zh' && !(parts.length > 1 && isScript(parts[1]))) {
		const region = parts.length > 1 && isRegion(parts[1]) ? parts[1].toUpperCase() : '';
		const script = ['TW', 'HK', 'MO'].includes(region) ? 'Hant' : 'Hans';
		parts = ['zh', script, ...parts.slice(1)];
	}
	for (let n = parts.length; n >= 1; n--) out.push(parts.slice(0, n).join('-'));
	return out;
}

/**
 * The interface language: the first candidate (in order) with a hit in `supported`, as `supported` spells it;
 * `en` when none hits. Candidates: the stored setting if non-empty, else the browser's languages.
 */
export function negotiate(candidates: readonly string[], supported: readonly string[]): string {
	const bySpelling = new Map(supported.map((s) => [s.toLowerCase(), s]));
	for (const c of candidates) {
		if (typeof c !== 'string' || c === '') continue;
		for (const tag of chain(c)) {
			const hit = bySpelling.get(tag.toLowerCase());
			if (hit !== undefined) return hit;
		}
	}
	return DEFAULT_LANGUAGE;
}

/** The region subtag of a tag (the first 2-letter or 3-digit subtag after the primary one), or ''. */
function regionOf(tag: string): string {
	const parts = tag.split('-').slice(1);
	for (const p of parts) {
		if (isScript(p)) continue;
		return isRegion(p) ? p.toUpperCase() : '';
	}
	return '';
}

/**
 * The locale for dates and numbers: the interface language plus the region of the first device language with
 * the same primary subtag, unless the interface language has its own region; English without a region and anything
 * Intl cannot resolve format as `DEFAULT_FORMAT_LOCALE` (en-GB).
 */
export function formatLocale(interfaceLanguage: string, deviceLanguages: readonly string[]): string {
	let result = interfaceLanguage;
	if (regionOf(interfaceLanguage) === '') {
		const primary = interfaceLanguage.split('-')[0].toLowerCase();
		const same = deviceLanguages.find((d) => typeof d === 'string' && d.split('-')[0].toLowerCase() === primary);
		const region = same === undefined ? '' : regionOf(same);
		if (region !== '') result = `${interfaceLanguage}-${region}`;
	}
	try {
		const [canonical] = Intl.getCanonicalLocales(result);
		return canonical === undefined || canonical === DEFAULT_LANGUAGE ? DEFAULT_FORMAT_LOCALE : canonical;
	} catch {
		return DEFAULT_FORMAT_LOCALE;
	}
}
