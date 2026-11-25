// The Android back button and back gesture. The shell tells the page (App `backButton`) and the page decides, in
// this order: the innermost open thing (a menu, a dialog, a sheet, the drawer), then the browser history, then
// leave the app (to the background: the Android habit; a second press from the launcher closes it).
import { dismissTop } from '$lib/ui/dismissStack';
import { appPlugin, type PluginListener } from './shell';

export interface BackDeps {
	/** Closes the innermost registered overlay; true when there was one. */
	dismiss(): boolean;
	/** Offers an Escape key press to whatever listens for it (overlays the registry does not know). */
	escape(): boolean;
	goBack(): void;
	leave(): void;
}

/** onBack is the whole decision for one press; `canGoBack` is the WebView's. */
export function onBack(canGoBack: boolean, deps: BackDeps): 'overlay' | 'escape' | 'history' | 'leave' {
	if (deps.dismiss()) return 'overlay';
	if (deps.escape()) return 'escape';
	if (canGoBack) {
		deps.goBack();
		return 'history';
	}
	deps.leave();
	return 'leave';
}

/**
 * pressEscape dispatches an Escape key press at the focused element; true when something handled it (called
 * preventDefault). Overlays outside the registry (a reader popup, the highlight editor, a margin note) close on
 * Escape, so the back button reaches them too.
 */
export function pressEscape(doc: Document): boolean {
	const target = doc.activeElement ?? doc.body;
	const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true });
	target.dispatchEvent(event);
	return event.defaultPrevented;
}

/** startBackHandler listens for the back button; it does nothing outside the shell. Returns the stop. */
export function startBackHandler(): () => void {
	const app = appPlugin();
	if (app === null) return () => undefined;
	let listener: PluginListener | null = null;
	let stopped = false;
	// The injected `Capacitor.Plugins.App` proxy returns the handle itself (no promise), the module's returns a
	// promise (found on the emulator, #35): Promise.resolve takes both, and a throw never breaks the page.
	let added: PluginListener | Promise<PluginListener>;
	try {
		added = app.addListener('backButton', ({ canGoBack }) =>
			onBack(canGoBack, {
				dismiss: dismissTop,
				escape: () => pressEscape(document),
				goBack: () => history.back(),
				leave: () => void app.minimizeApp()
			})
		);
	} catch {
		return () => undefined;
	}
	void Promise.resolve(added)
		.then((l) => {
			if (stopped) void l?.remove?.();
			else listener = l ?? null;
		})
		.catch(() => undefined);
	return () => {
		stopped = true;
		void listener?.remove?.();
	};
}
