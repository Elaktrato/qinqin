// The interface language on the web (issue #73, spec "Interface language setting", web flow). Signed out the
// browser's languages decide; signed in the stored setting from `me.interfaceLanguage` ('' = follow the browser).
// The last resolved language is mirrored in localStorage for the first paint and an offline start; when `me`
// brings a different one, the page reloads once (`t` is no store: a language change is a reload, spec Ruling).
// The reload is guarded so it can never loop (see followServerLanguage).
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

export function writeMirror(storage: Storage | null, language: string): boolean {
	if (storage === null) return false;
	try {
		storage.setItem(MIRROR_KEY, language);
		return storage.getItem(MIRROR_KEY) === language;
	} catch {
		// Storage denied: the next start negotiates from the browser again. A
		// stale value that happens to equal `language` must not count as written.
		return false;
	}
}

/** The language to start with, before `me` has answered: the mirror while signed in, else the browser's. */
export function startupLanguage(o: { signedIn: boolean; storage: Storage | null; browser: readonly string[] }): string {
	const mirrored = o.signedIn ? readMirror(o.storage) : null;
	return resolveInterfaceLanguage(mirrored ?? undefined, o.browser);
}

/** sessionStorage: set just before a language reload, so the start it causes never reloads again. */
export const RELOAD_MARKER_KEY = 'qq.interfaceLanguage.reloaded';

/** Writes the mirror and reads it back: true only when it now holds `language` (a reload would then apply it). */
function mirrorHolds(storage: Storage | null, language: string): boolean {
	return writeMirror(storage, language) && readMirror(storage) === language;
}

/** Reads and removes the one-shot reload marker; a blocked sessionStorage reads as unmarked. */
function takeReloadMarker(session: Storage | null): boolean {
	try {
		const marked = session?.getItem(RELOAD_MARKER_KEY) != null;
		if (marked) session?.removeItem(RELOAD_MARKER_KEY);
		return marked;
	} catch {
		return false;
	}
}

/** Sets the one-shot reload marker; false when it cannot be stored (then no reload: it could not be bounded). */
function setReloadMarker(session: Storage | null): boolean {
	try {
		if (!session) return false;
		session.setItem(RELOAD_MARKER_KEY, '1');
		return session.getItem(RELOAD_MARKER_KEY) !== null;
	} catch {
		return false;
	}
}

/**
 * After `me` loaded: mirror the account's resolved language, and reload when its catalogue differs from the running
 * one. Never loops: it reloads only when the mirror now holds the language (blocked storage would also drop an
 * unstored session on reload), when the language's catalogue (`catalogue`, as `loadCatalogue` would install it)
 * differs from the running one, and at most once per start (a sessionStorage marker). Returns whether it reloads.
 */
export function followServerLanguage(
	me: { interfaceLanguage?: string },
	o: {
		running: string;
		storage: Storage | null;
		session: Storage | null;
		browser: readonly string[];
		catalogue: (language: string) => string;
		reload: () => void;
	}
): boolean {
	const resolved = resolveInterfaceLanguage(me.interfaceLanguage ?? '', o.browser);
	const reloadedOnce = takeReloadMarker(o.session);
	if (!mirrorHolds(o.storage, resolved)) return false;
	if (o.catalogue(resolved) === o.running) return false;
	if (reloadedOnce || !setReloadMarker(o.session)) return false;
	o.reload();
	return true;
}

/**
 * Settings saved a new interface language: mirror it and reload, but only when the mirror now holds it (else the
 * reload would neither show it nor keep an unstored session). Returns whether it reloads.
 */
export function switchInterfaceLanguage(resolved: string, o: { storage: Storage | null; reload: () => void }): boolean {
	if (!mirrorHolds(o.storage, resolved)) return false;
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
