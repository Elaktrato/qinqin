// Installing the app: the Chromium install prompt, iOS and standalone
// detection, byte formatting, and the one-time storage persistence request.

import { writable } from 'svelte/store';

interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** The deferred `beforeinstallprompt` (Chromium); null when none is waiting. */
export const installPrompt = writable<InstallPromptEvent | null>(null);

let captured: InstallPromptEvent | null = null;

/** captureInstallPrompt listens on `target` (the window) for the install events; returns the unsubscribe. */
export function captureInstallPrompt(target: EventTarget = window): () => void {
	const onPrompt = (event: Event): void => {
		// Keep the browser from showing its own bar: the Settings button asks.
		event.preventDefault();
		captured = event as InstallPromptEvent;
		installPrompt.set(captured);
	};
	const onInstalled = (): void => {
		captured = null;
		installPrompt.set(null);
	};
	target.addEventListener('beforeinstallprompt', onPrompt);
	target.addEventListener('appinstalled', onInstalled);
	return () => {
		target.removeEventListener('beforeinstallprompt', onPrompt);
		target.removeEventListener('appinstalled', onInstalled);
	};
}

/** promptInstall shows the browser's install dialog once per captured prompt. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
	const event = captured;
	if (event === null) return 'unavailable';
	captured = null;
	installPrompt.set(null);
	try {
		await event.prompt();
		return (await event.userChoice).outcome;
	} catch {
		return 'dismissed';
	}
}

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
