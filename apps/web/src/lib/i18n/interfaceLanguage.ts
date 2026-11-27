// The interface language on the web (issue #73, spec "Interface language setting", web flow; per workspace #297,
// docs/contracts/settings/interface-language.json). Signed out the browser's languages decide; signed in the current
// workspace's own setting, else the account's `me.interfaceLanguage` ('' = follow the browser). The catalogue is
// chosen once per page load (`t` is no store: a language change is a reload, spec Ruling) from mirrors in
// localStorage, so the first paint and an offline start need no request: the account's resolved language, and per
// workspace its own setting. When `me` and the workspace list bring a different language, or the person switches to
// a workspace in another language, the page reloads once. The reload is guarded so it can never loop (see
// followInterfaceLanguage).
import { SUPPORTED_LANGUAGES, isLanguageSetting, negotiate } from './negotiate';
import { resolveWorkspaceLanguage, workspaceSetting } from './workspaceLanguage';

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

/** The per-workspace mirror: the workspace's own setting, absent when it uses the account's (#297). */
export function workspaceMirrorKey(workspaceId: number): string {
	return `${MIRROR_KEY}.workspace.${workspaceId}`;
}

/** The mirrored own setting of a workspace, or null (none, storage blocked, or not a tag). */
export function readWorkspaceMirror(storage: Storage | null, workspaceId: number): string | null {
	try {
		const v = storage?.getItem(workspaceMirrorKey(workspaceId)) ?? null;
		return v !== null && v !== '' && isLanguageSetting(v) ? v : null;
	} catch {
		return null;
	}
}

/** Mirrors a workspace's own setting ('' removes it). Best effort: the caller checks what the next start reads. */
function writeWorkspaceMirror(storage: Storage | null, workspaceId: number, setting: string): void {
	try {
		if (setting === '') storage?.removeItem(workspaceMirrorKey(workspaceId));
		else storage?.setItem(workspaceMirrorKey(workspaceId), setting);
	} catch {
		// Storage denied: the next start reads what was there (followInterfaceLanguage then does not reload).
	}
}

/** Drops a deleted workspace's mirror. */
export function forgetWorkspaceMirror(storage: Storage | null, workspaceId: number): void {
	writeWorkspaceMirror(storage, workspaceId, '');
}

/**
 * The language to start with, before `me` has answered: signed in, the remembered workspace's mirrored own setting,
 * else the account's mirror; signed out (or nothing mirrored) the browser's.
 */
export function startupLanguage(o: {
	signedIn: boolean;
	storage: Storage | null;
	browser: readonly string[];
	/** The remembered current workspace (lib/workspace WORKSPACE_KEY), or null. */
	workspace?: number | null;
}): string {
	if (!o.signedIn) return resolveInterfaceLanguage(undefined, o.browser);
	const own = o.workspace == null ? null : readWorkspaceMirror(o.storage, o.workspace);
	const mirrored = own ?? readMirror(o.storage);
	return resolveInterfaceLanguage(mirrored ?? undefined, o.browser);
}

/** sessionStorage: set just before a language reload, so the start it causes never reloads again. */
export const RELOAD_MARKER_KEY = 'qq.interfaceLanguage.reloaded';

/** Writes the account mirror and reads it back: true only when it now holds `language`. */
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
 * After `me` and the workspace list loaded, and whenever the current workspace, its setting or the account setting
 * changes: mirror the account's resolved language and the workspace's own setting, and reload when the language of
 * this page load (`workspace` null: outside a workspace, the account's) has another catalogue than the running one.
 * Never loops: it reloads only when the next start would pick that language (both mirrors read back for the
 * workspace now selected; blocked storage would also drop an unstored session on reload), when that language's
 * catalogue (`catalogue`, as `loadCatalogue` would install it) differs from the running one, and never at a start a
 * language reload caused (a one-shot sessionStorage marker, taken by the first call of a start). Returns whether it
 * reloads.
 */
export function followInterfaceLanguage(
	input: {
		/** The account's setting (`me.interfaceLanguage`; undefined from an older server = follow the browser). */
		account: string | undefined;
		workspace: { id: number; settings?: Readonly<Record<string, unknown>> | null } | null;
	},
	o: {
		running: string;
		storage: Storage | null;
		session: Storage | null;
		browser: readonly string[];
		catalogue: (language: string) => string;
		reload: () => void;
		/** Outside a workspace: the workspace the next start would still open in (a restricted session keeps it). */
		remembered?: number | null;
	}
): boolean {
	const account = input.account ?? '';
	const wanted = resolveWorkspaceLanguage(input.workspace, account, o.browser);
	const reloadedOnce = takeReloadMarker(o.session);
	writeMirror(o.storage, resolveInterfaceLanguage(account, o.browser));
	if (input.workspace !== null) writeWorkspaceMirror(o.storage, input.workspace.id, workspaceSetting(input.workspace.settings));
	const workspace = input.workspace?.id ?? o.remembered ?? null;
	const next = startupLanguage({ signedIn: true, storage: o.storage, browser: o.browser, workspace });
	if (next !== wanted) return false;
	if (o.catalogue(wanted) === o.running) return false;
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
