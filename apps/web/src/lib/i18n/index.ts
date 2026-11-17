// The interface-text runtime (issue #73, docs/contracts/i18n/README.md). `t` is a plain function, not a store:
// changing the interface language reloads the page (spec Ruling), so a module never re-renders for it.
//
// Rules for callers (spec):
// - Keys are literals: `t('settings.account.title')`, or a typed map `Record<Tab, MessageKey>` whose values are
//   literals. Never a template literal (`t(\`x.${y}\`)`): the catalogue test fails on it.
// - Never call `t` at module top level: a non-English catalogue is installed before the app mounts, after
//   modules are evaluated. Call it in a function, a `$derived`, or markup.
// - Numbers and dates in `{name}` arguments are pre-formatted with `$lib/i18n/format` helpers; a plural's `#` is
//   formatted for you.
import en from './messages/en.json';
import { formatMessage, formatParts, type Part } from './message';
import { DEFAULT_FORMAT_LOCALE, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, formatLocale, negotiate } from './negotiate';

export type MessageKey = keyof typeof en;
export type MessageArgs = Readonly<Record<string, string | number>>;
export type { Part } from './message';

const english: Readonly<Record<string, string>> = en;

/** Development and tests: missing arguments and unknown keys throw, fallbacks warn. Production: never throws. */
const strict: boolean = import.meta.env.DEV || import.meta.env.MODE === 'test';

let language = DEFAULT_LANGUAGE;
let messages: Readonly<Record<string, string>> = english;
let fmtLocale = DEFAULT_FORMAT_LOCALE;
const warned = new Set<string>();

/** Lazily loaded non-English catalogues; `en` is in the main bundle. */
const loaders = import.meta.glob<{ default: Record<string, string> }>([
	'./messages/*.json',
	'!./messages/en.json',
	'!./messages/notes.json'
]);

function lookup(key: string): string {
	const own = messages[key];
	if (own !== undefined) return own;
	const fallback = english[key];
	if (fallback === undefined) {
		if (strict) throw new Error(`unknown message key ${key}`);
		return key;
	}
	if (strict && language !== DEFAULT_LANGUAGE && !warned.has(`${language} ${key}`)) {
		warned.add(`${language} ${key}`);
		console.warn(`i18n: ${key} is missing in ${language}, using en`);
	}
	return fallback;
}

/** The message `key` of the active catalogue (en per-key fallback), formatted with `args`. */
export function t(key: MessageKey, args: MessageArgs = {}): string {
	return formatMessage(lookup(key), fmtLocale, args, { missing: strict ? 'throw' : 'keep' });
}

/**
 * A record of interface labels read lazily: each property is a getter that calls `t` when read, so a module may
 * define the record at top level (`const LABELS = labelRecord({ read: 'settings.tokens.readOnly' })`).
 */
export function labelRecord<K extends string>(keys: Readonly<Record<K, MessageKey>>): Readonly<Record<K, string>> {
	const out = {} as Record<K, string>;
	for (const name of Object.keys(keys) as K[]) {
		Object.defineProperty(out, name, { enumerable: true, get: () => t(keys[name]) });
	}
	return out;
}

/** Rich-text parts of a message (`<Msg>` renders them; tags become snippets). */
export function tParts(key: MessageKey, args: MessageArgs = {}): Part[] {
	return formatParts(lookup(key), fmtLocale, args, { missing: strict ? 'throw' : 'keep' });
}

/** The resolved interface language (`<html lang>`). */
export function getLanguage(): string {
	return language;
}

/** The locale for dates and numbers: the interface language plus the device region (`format.ts` uses it). */
export function getFormatLocale(): string {
	return fmtLocale;
}

function deviceLanguages(): readonly string[] {
	return typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
}

/**
 * Installs the catalogue of a resolved interface language before the app mounts (root `+layout.ts`). A language
 * without a catalogue resolves to en; en needs no request.
 */
export async function loadCatalogue(lang: string, device: readonly string[] = deviceLanguages()): Promise<void> {
	const resolved = negotiate([lang], SUPPORTED_LANGUAGES);
	let next: Readonly<Record<string, string>> = english;
	const loader = loaders[`./messages/${resolved}.json`];
	const chosen = resolved !== DEFAULT_LANGUAGE && loader !== undefined ? resolved : DEFAULT_LANGUAGE;
	if (chosen !== DEFAULT_LANGUAGE) next = (await loader()).default;
	language = chosen;
	messages = next;
	fmtLocale = formatLocale(chosen, device);
}

/** Tests and the pseudo-locale harness: installs a catalogue directly. */
export function installCatalogue(lang: string, catalogue: Readonly<Record<string, string>>, locale: string = lang): void {
	language = lang;
	messages = catalogue;
	fmtLocale = locale;
}

/** Tests: back to the English catalogue and the default (en-GB) format locale. */
export function resetCatalogue(): void {
	installCatalogue(DEFAULT_LANGUAGE, english, DEFAULT_FORMAT_LOCALE);
}
