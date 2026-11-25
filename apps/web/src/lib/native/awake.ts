// Screen awake during a study session. In the shell: the window's keep-screen-on flag. In a browser: the Screen
// Wake Lock API where the browser has it (it drops the lock when the tab is hidden, so it is asked for again
// when the tab returns). Nothing otherwise.
import { shellPlugin } from './shell';

interface WakeLockSentinelLike {
	release(): Promise<void>;
}
interface WakeLockLike {
	request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

let holders = 0;
let sentinel: WakeLockSentinelLike | null = null;
let asking = false;
let visibilityOn = false;

const wakeLock = (): WakeLockLike | null =>
	typeof navigator !== 'undefined' ? ((navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock ?? null) : null;

async function acquire(): Promise<void> {
	const lock = wakeLock();
	if (lock === null || sentinel !== null || asking || holders === 0) return;
	asking = true;
	try {
		const s = await lock.request('screen');
		if (holders === 0) await s.release();
		else sentinel = s;
	} catch {
		// refused (battery saver, hidden tab): the screen simply may sleep
	} finally {
		asking = false;
	}
}

function onVisible(): void {
	// The browser released the lock when the tab was hidden.
	if (document.visibilityState === 'visible') {
		sentinel = null;
		void acquire();
	}
}

function start(): void {
	const shell = shellPlugin();
	if (shell !== null) {
		void Promise.resolve(shell.keepAwake({ on: true })).catch(() => undefined);
		return;
	}
	if (wakeLock() === null) return;
	if (!visibilityOn) {
		document.addEventListener('visibilitychange', onVisible);
		visibilityOn = true;
	}
	void acquire();
}

function stop(): void {
	const shell = shellPlugin();
	if (shell !== null) {
		void Promise.resolve(shell.keepAwake({ on: false })).catch(() => undefined);
		return;
	}
	if (visibilityOn) {
		document.removeEventListener('visibilitychange', onVisible);
		visibilityOn = false;
	}
	const s = sentinel;
	sentinel = null;
	if (s !== null) void s.release().catch(() => undefined);
}

/**
 * keepAwake keeps the screen on until the returned function is called (a study session holds it while it runs).
 * Holds are counted: the screen may sleep again only after the last release.
 */
export function keepAwake(): () => void {
	holders += 1;
	if (holders === 1) start();
	let released = false;
	return () => {
		if (released) return;
		released = true;
		holders -= 1;
		if (holders === 0) stop();
	};
}
