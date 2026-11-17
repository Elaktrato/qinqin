// The interface language on the web (issue #73, spec "Interface language setting", web flow). Signed out the
// browser's languages decide; signed in the stored setting from `me.interfaceLanguage` ('' = follow the browser).
// The last resolved language is mirrored in localStorage for the first paint and an offline start; when `me`
// brings a different one, the page reloads once (`t` is no store: a language change is a reload, spec Ruling).
import { SUPPORTED_LANGUAGES, isLanguageSetting, negotiate } from './negotiate';

export const MIRROR_KEY = 'qq.interfaceLanguage';

const RTL = new Set(['ar', 'fa', 'he', 'ur']);

/** The resolved interface language: the stored setting if non-empty, else the browser's languages. */
export function resolveInterfaceLanguage(setting: string | undefined, browser: readonly string[]): string {
	return negotiate(setting ? [setting] : [...browser], SUPPORTED_LANGUAGES);
}

/** The mirrored language, or null (nothing stored, storage blocked, or not a tag). */
export function readMirror(storage: Storage | null): string | null {
	try {
		const v = storage?.getItem(MIRROR_KEY) ?? null;
		return v !== null && v !== '' && isLanguageSetting(v) ? v : null;
	} catch {
		return null;
	}
}

export function writeMirror(storage: Storage | null, language: string): void {
	try {
		storage?.setItem(MIRROR_KEY, language);
	} catch {
		// Storage denied: the next start negotiates from the browser again.
	}
}

/** The language to start with, before `me` has answered: the mirror while signed in, else the browser's. */
export function startupLanguage(o: { signedIn: boolean; storage: Storage | null; browser: readonly string[] }): string {
	const mirrored = o.signedIn ? readMirror(o.storage) : null;
	return resolveInterfaceLanguage(mirrored ?? undefined, o.browser);
}

/**
 * After `me` loaded: mirror the account's resolved language, and reload when it differs from the running one.
 * Returns whether it reloads.
 */
export function followServerLanguage(
	me: { interfaceLanguage?: string },
	o: { running: string; storage: Storage | null; browser: readonly string[]; reload: () => void }
): boolean {
	const resolved = resolveInterfaceLanguage(me.interfaceLanguage ?? '', o.browser);
	writeMirror(o.storage, resolved);
	if (resolved === o.running) return false;
	o.reload();
	return true;
}

/** `<html lang>` and `dir` for the interface language. */
export function applyDocumentLanguage(
	el: { setAttribute(name: string, value: string): void },
	language: string
): void {
	el.setAttribute('lang', language);
	el.setAttribute('dir', RTL.has(language.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr');
}
