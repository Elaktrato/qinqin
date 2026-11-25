// The native shell (docs/architecture/0010-android-shell-and-native-bridge.md): the Android app loads this web
// app from the person's own server inside a Capacitor WebView. This folder is the ONLY place the web app knows
// about it, and every function here does nothing in a normal browser.
//
// The shell injects `window.Capacitor` and its plugins into this page (only for the server's own origin).
// Nothing is imported from @capacitor/*: the same build runs in browsers and in the shell, so the plugins are
// reached through the injected global, typed by the small interfaces below.

export interface PluginListener {
	remove(): Promise<void>;
}

interface CapacitorGlobal {
	isNativePlatform?: () => boolean;
	getPlatform?: () => string;
	Plugins?: Record<string, unknown>;
	registerPlugin?: (name: string) => unknown;
}

function capacitor(): CapacitorGlobal | null {
	if (typeof window === 'undefined') return null;
	const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
	return cap ?? null;
}

/** isShell: true only inside the Android app (Capacitor's native platform). */
export function isShell(): boolean {
	try {
		return capacitor()?.isNativePlatform?.() === true;
	} catch {
		return false;
	}
}

/** plugin returns a shell plugin by name (the injected proxy), or null outside the shell. */
export function plugin<T>(name: string): T | null {
	if (!isShell()) return null;
	const cap = capacitor();
	const known = cap?.Plugins?.[name];
	if (known !== undefined) return known as T;
	return (cap?.registerPlugin?.(name) as T | undefined) ?? null;
}

/** What the shell's own plugin (QinqinShell, apps/android) offers the web app. */
export interface ShellPlugin {
	clearServer(): Promise<void>;
	setBars(options: { background: string; darkIcons: boolean }): Promise<void>;
}

export interface AppPlugin {
	addListener(event: 'backButton', listener: (event: { canGoBack: boolean }) => void): Promise<PluginListener>;
	minimizeApp(): Promise<void>;
	exitApp(): Promise<void>;
}

export const shellPlugin = (): ShellPlugin | null => plugin<ShellPlugin>('QinqinShell');
export const appPlugin = (): AppPlugin | null => plugin<AppPlugin>('App');
