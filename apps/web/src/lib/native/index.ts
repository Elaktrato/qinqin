// lib/native: the web app's one door to the Android shell (record 0010). Everything is a no-op in a browser.
import { startBackHandler } from './back';
import { startShellBars } from './bars';
import { isShell, shellPlugin } from './shell';

export { isShell } from './shell';

/** startNative wires the shell's back button and system bars to the page; the root layout calls it once. */
export function startNative(): () => void {
	if (!isShell()) return () => undefined;
	const stops = [startBackHandler(), startShellBars()];
	return () => {
		for (const stop of stops) stop();
	};
}

/** canChangeServer: only the shell has a server address to change. */
export function canChangeServer(): boolean {
	return isShell();
}

/** changeServer forgets the saved server; the shell returns to its first-run screen. */
export async function changeServer(): Promise<void> {
	await shellPlugin()?.clearServer();
}
