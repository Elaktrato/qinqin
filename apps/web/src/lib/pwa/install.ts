// Installing the app: iOS and standalone detection, byte formatting, and the
// one-time storage persistence request (the install prompt itself is the app
// context's InstallPrompt, installPrompt.svelte.ts).

/** isIos: iPhone/iPad, including the iPad that reports itself as a Mac (touch points). */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
	if (/iPhone|iPad|iPod/.test(userAgent)) return true;
	return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

export function isStandalone(env: {
	matchMedia: ((query: string) => { matches: boolean }) | undefined;
	standalone: boolean | undefined;
}): boolean {
	if (env.standalone === true) return true;
	try {
		return env.matchMedia?.('(display-mode: standalone)').matches === true;
	} catch {
		return false;
	}
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
}

const PERSIST_KEY = 'qinqin.pwa.persist';

/**
 * requestPersistOnce asks the browser not to evict this origin's storage,
 * once, when the app runs installed (browsers grant it far more readily then).
 */
export async function requestPersistOnce(env: {
	standalone: boolean;
	persist: (() => Promise<boolean>) | undefined;
	storage: Pick<Storage, 'getItem' | 'setItem'> | null;
}): Promise<void> {
	if (!env.standalone || env.persist === undefined) return;
	try {
		if (env.storage?.getItem(PERSIST_KEY) !== null && env.storage?.getItem(PERSIST_KEY) !== undefined) return;
		env.storage?.setItem(PERSIST_KEY, '1');
		await env.persist();
	} catch {
		// Not granted or not available: nothing depends on it.
	}
}

/** The browser-facing wrappers the app shell uses. */
export function currentStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return isStandalone({
		matchMedia: window.matchMedia?.bind(window),
		standalone: (navigator as { standalone?: boolean }).standalone
	});
}

export function currentIos(): boolean {
	return typeof navigator !== 'undefined' && isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

export function persistOnceNow(): Promise<void> {
	if (typeof navigator === 'undefined') return Promise.resolve();
	let storage: Storage | null = null;
	try {
		storage = localStorage;
	} catch {
		storage = null;
	}
	return requestPersistOnce({
		standalone: currentStandalone(),
		persist: navigator.storage?.persist?.bind(navigator.storage),
		storage
	});
}
