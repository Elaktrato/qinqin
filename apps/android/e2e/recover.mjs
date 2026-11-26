// Recovery of the emulator driver from an unplanned activity relaunch.
//
// Found in the CI logs of the flaky runs (#35/#37): in a failing run the shell's MainActivity is destroyed and
// created again a second time, some seconds after the planned recreate that opens the server page (the first
// `Schedule relaunch` is the shell's own recreate(); the passing runs show exactly one destroy, the failing ones two).
// The system relaunches the activity (a configuration change nobody asked for, in a burst of package changes on the
// google_apis image) and the WebView of the first page is destroyed: the driver's DevTools socket then never answers
// ("Runtime.evaluate: no answer in 60 s") or closes ("DevTools socket closed"), and every later step fails the same
// way. A real phone user would see the web app reload; the driver has to attach to the new page.
//
// No adb or WebSocket in this file: the counting and the retry rule are pure and tested (recover.test.mjs).

/** Counts "App destroyed" lines that the Capacitor activity logs (tag Capacitor), from chunks of `adb logcat` text. */
export class RelaunchCounter {
	constructor() {
		this.count = 0;
		this.rest = '';
		this.listeners = [];
	}

	/** onRelaunch: calls fn(count) after every counted line. A listener that throws is ignored. */
	onRelaunch(fn) {
		this.listeners.push(fn);
	}

	feed(chunk) {
		const text = this.rest + String(chunk);
		const lines = text.split('\n');
		this.rest = lines.pop() ?? '';
		for (const raw of lines) {
			const line = raw.replace(/\r$/, '');
			// `D/Capacitor( 4675): App destroyed`; the AppPlugin lines carry the tag Capacitor/AppPlugin and do not count.
			if (!/[VDIWE]\/Capacitor\(\s*\d+\):\s+App destroyed\s*$/.test(line)) continue;
			this.count++;
			for (const fn of this.listeners) {
				try {
					fn(this.count);
				} catch {
					// A broken listener must not stop the counting.
				}
			}
		}
	}
}

/** looksDead: an error that a destroyed or silent DevTools target produces (and a step timeout around one). */
export function looksDead(err) {
	return /socket closed|no answer in|timeout|target closed/i.test(String(err?.message ?? err ?? ''));
}

/**
 * withRecovery: runs `fn`; if it throws a dead-page error while the activity was relaunched during it, runs
 * `recover()` (attach to the new page) and `fn` once more. Anything else is thrown as it is. A step whose page
 * died without a relaunch stays a failure: this is not a general retry.
 * Returns { value, retried }.
 */
export async function withRecovery(fn, { counter, recover, enabled = true }) {
	const before = counter.count;
	try {
		return { value: await fn(), retried: false };
	} catch (err) {
		if (!enabled || !looksDead(err) || counter.count <= before) throw err;
		console.log(`the activity was relaunched during the step (${err.message}); attaching to the new page and running the step again`);
		await recover();
		return { value: await fn(), retried: true };
	}
}
