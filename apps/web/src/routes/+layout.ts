// The whole app is a client-side SPA served by the Go binary: no server
// rendering, no prerendering, so every route is an entry into the router.
// Auth is client-only too: the layout hydrates `qinqin.token` from
// localStorage in onMount, which only runs with SSR off.
export const ssr = false;
export const prerender = false;

import { getLanguage, loadCatalogue } from '$lib/i18n';
import { applyDocumentLanguage, startupLanguage } from '$lib/i18n/interfaceLanguage';
import { TOKEN_KEY } from '$lib/api/client';
import { applyStartupTheme } from '$lib/theme/apply';

function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

/**
 * Before the app mounts: the interface catalogue (signed out the browser's languages; signed in the mirrored
 * language of the account, so the first paint and an offline start need no request) and `<html lang>`/`dir`.
 * When `me` brings another language, `loadMe` reloads once (lib/i18n/interfaceLanguage.ts).
 */
export async function load(): Promise<Record<string, never>> {
	// The theme first: the last tokens of this device or the compiled-in
	// qinqin Day/Night (app.html already painted the stored ones before any module).
	applyStartupTheme();
	const store = storage();
	let signedIn = false;
	try {
		signedIn = !!store?.getItem(TOKEN_KEY);
	} catch {
		signedIn = false;
	}
	const browser = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
	await loadCatalogue(startupLanguage({ signedIn, storage: store, browser }));
	if (typeof document !== 'undefined') applyDocumentLanguage(document.documentElement, getLanguage());
	return {};
}
