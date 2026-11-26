// Helpers of the emulator job (#35): adb, a dependency-free Chrome DevTools Protocol client over Node's global
// WebSocket, and a step recorder that prints a machine-readable summary. No Playwright, no `ws`.
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RelaunchCounter, withRecovery } from './recover.mjs';

export const PKG = process.env.E2E_PACKAGE || 'io.github.elaktrato.qinqin';
export const OUT = process.env.E2E_OUT || join(process.cwd(), 'e2e-out');
mkdirSync(OUT, { recursive: true });
const ADB = process.env.ADB || 'adb';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** adb: runs `adb <args>`; returns trimmed stdout. A failing command throws unless `soft`. */
export function adb(args, { soft = false, timeout = 120_000 } = {}) {
	try {
		return execFileSync(ADB, args, { encoding: 'utf8', timeout, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
	} catch (err) {
		if (soft) return `ERROR: ${(err.stderr || err.message || '').toString().trim()}`;
		throw new Error(`adb ${args.join(' ')}: ${(err.stderr || err.message || '').toString().trim()}`);
	}
}

export async function waitFor(what, fn, { timeout = 30_000, interval = 500 } = {}) {
	const until = Date.now() + timeout;
	let last;
	for (;;) {
		try {
			const v = await fn();
			if (v) return v;
			last = undefined;
		} catch (err) {
			last = err;
		}
		if (Date.now() > until) throw new Error(`timeout (${timeout} ms) waiting for ${what}${last ? `: ${last.message}` : ''}`);
		await sleep(interval);
	}
}

/**
 * dismissAnr: a busy software emulator shows "<app> isn't responding" even with hide_error_dialogs; it swallows adb
 * touches and sits in screenshots. When one is on screen, taps its "Wait" button (the app keeps running). Returns
 * true when one was dismissed.
 */
export function dismissAnr() {
	try {
		if (!/Application Not Responding|isn't responding/.test(adb(['shell', 'dumpsys', 'window', 'windows'], { soft: true, timeout: 20_000 }))) return false;
		adb(['shell', 'uiautomator', 'dump', '/sdcard/anr.xml'], { soft: true, timeout: 30_000 });
		const xml = adb(['shell', 'cat', '/sdcard/anr.xml'], { soft: true });
		const m = /text="Wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
		if (!m) return false;
		adb(['shell', 'input', 'tap', String(Math.round((+m[1] + +m[3]) / 2)), String(Math.round((+m[2] + +m[4]) / 2))], { soft: true });
		return true;
	} catch {
		return false;
	}
}

export function screenshot(name) {
	dismissAnr();
	try {
		const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 });
		writeFileSync(join(OUT, `${name}.png`), png);
	} catch {
		// A missing screenshot never fails a step.
	}
}

/**
 * gmsSettled: waits until Google Play services (the google_apis image) stopped restarting: its persistent process
 * keeps one pid for `quietMs`. A restart of it kills apps bound to its fonts provider, ours included, so the driver
 * starts only after it has settled (or after `max` ms, whichever comes first).
 */
export async function gmsSettled({ quietMs = 20_000, max = 120_000 } = {}) {
	const pidOf = () => adb(['shell', 'pidof', 'com.google.android.gms.persistent'], { soft: true }).split(/\s+/)[0];
	const t0 = Date.now();
	let pid = pidOf();
	let since = Date.now();
	let restarts = 0;
	while (Date.now() - t0 < max) {
		await sleep(2500);
		const now = pidOf();
		if (now !== pid) {
			pid = now;
			since = Date.now();
			restarts++;
		} else if (/^\d+$/.test(pid) && Date.now() - since >= quietMs) break;
	}
	return { settled: Date.now() - since >= quietMs, waitedMs: Date.now() - t0, restarts, pid };
}

export function appPid() {
	const out = adb(['shell', 'pidof', PKG], { soft: true });
	return /^\d+/.test(out) ? out.split(/\s+/)[0] : null;
}

/** Counts the activity relaunches that `startRelaunchWatch` sees (see recover.mjs). */
export const relaunches = new RelaunchCounter();
const liveCdps = new Set();

/**
 * startRelaunchWatch: follows the shell's own log tag (`Capacitor`) from now on and counts "App destroyed". A DevTools
 * connection made before a relaunch is to a destroyed WebView: its pending calls fail at once instead of after 60 s.
 */
export function startRelaunchWatch() {
	const child = spawn(ADB, ['logcat', '-v', 'time', '-T', '1', 'Capacitor:D', '*:S'], { stdio: ['ignore', 'pipe', 'ignore'] });
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (chunk) => relaunches.feed(chunk));
	child.on('error', () => {
		// No logcat, no early abort: the step timeouts still end every wait.
	});
	relaunches.onRelaunch((n) => {
		console.log(`the shell's activity was destroyed (#${n})`);
		for (const c of [...liveCdps]) c.abortPending('DevTools socket closed (the activity was relaunched)');
	});
	return () => child.kill();
}

export class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 1;
		this.pending = new Map();
		this.listeners = new Map();
		this.prefix = '';
		liveCdps.add(this);
		ws.addEventListener('message', (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.method) for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
			const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
			else p.resolve(msg.result);
		});
		ws.addEventListener('close', () => {
			liveCdps.delete(this);
			this.abortPending('DevTools socket closed');
		});
	}

	/** abortPending: rejects every call that waits for an answer. */
	abortPending(message) {
		for (const p of this.pending.values()) p.reject(new Error(message));
		this.pending.clear();
	}

	send(method, params = {}, timeoutMs = 60_000) {
		const id = this.next++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, method });
			this.ws.send(JSON.stringify({ id, method, params }));
			setTimeout(() => {
				if (this.pending.delete(id)) reject(new Error(`${method}: no answer in ${timeoutMs / 1000} s`));
			}, timeoutMs);
		});
	}

	/** on: calls fn(params) for every DevTools event `method` (Runtime.exceptionThrown, ...). */
	on(method, fn) {
		this.listeners.set(method, [...(this.listeners.get(method) || []), fn]);
	}

	/** eval: the value of a JS expression in the page (promises awaited, result by value). */
	async eval(expression) {
		const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (r.exceptionDetails) throw new Error(`page exception: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
		return r.result.value;
	}

	close() {
		liveCdps.delete(this);
		try {
			this.ws.close();
		} catch {
			// Already closed.
		}
	}
}

/** connectPage: attaches to the app's WebView page whose URL starts with `prefix` (adb forward + /json + WebSocket). */
export async function connectPage(prefix, { timeout = 60_000 } = {}) {
	return waitFor(
		`a WebView page at ${prefix}`,
		async () => {
			const pid = appPid();
			if (!pid) return null;
			adb(['forward', 'tcp:9222', `localabstract:webview_devtools_remote_${pid}`]);
			const res = await fetch('http://127.0.0.1:9222/json');
			const pages = (await res.json()).filter((t) => t.type === 'page' && t.url.startsWith(prefix));
			if (pages.length === 0) return null;
			const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
			await new Promise((resolve, reject) => {
				ws.addEventListener('open', resolve, { once: true });
				ws.addEventListener('error', () => reject(new Error('DevTools socket error')), { once: true });
			});
			const cdp = new Cdp(ws);
			try {
				await cdp.send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, 8_000);
			} catch (err) {
				console.log(`target ${pages[0].url} did not answer (${err.message}); targets: ${JSON.stringify(pages.map((p) => p.url))}`);
				cdp.close();
				return null;
			}
			cdp.prefix = prefix;
			return cdp;
		},
		{ timeout, interval: 1000 }
	);
}

/** A step recorder: every step is timed; a failure is recorded and the next steps that depend on it are skipped by the caller. */
export class Recorder {
	constructor() {
		this.steps = [];
		this.numbers = {};
		this.failed = false;
		/** recover: set by the driver; attaches to the current page after an unplanned relaunch (recover.mjs). */
		this.recover = null;
	}

	async step(name, fn) {
		const t0 = Date.now();
		const entry = { name, ok: false, ms: 0 };
		this.steps.push(entry);
		console.log(`--- ${name}`);
		try {
			const { value: data, retried } = await withRecovery(fn, { counter: relaunches, recover: () => this.recover(), enabled: typeof this.recover === 'function' });
			entry.ok = true;
			if (retried) entry.retried = true;
			if (data !== undefined) entry.data = data;
		} catch (err) {
			entry.error = String(err.message || err);
			this.failed = true;
			console.log(`FAILED ${name}: ${entry.error}`);
			screenshot(`failed-${this.steps.length}`);
		}
		entry.ms = Date.now() - t0;
		if (entry.data !== undefined) console.log(JSON.stringify(entry.data));
		return entry.ok;
	}

	/** Marks the start of a suite: suiteFailed() looks only at the steps since. */
	startSuite() {
		this.from = this.steps.length;
	}

	suiteFailed() {
		return this.steps.slice(this.from || 0).some((x) => !x.ok);
	}

	summary() {
		return { ok: !this.failed && this.steps.every((s) => s.ok), steps: this.steps, numbers: this.numbers };
	}

	write() {
		const text = JSON.stringify(this.summary());
		writeFileSync(join(OUT, 'summary.json'), JSON.stringify(this.summary(), null, 2));
		console.log(`SUMMARY ${text}`);
	}
}

/** Prints the log lines that matter when something fails (the whole log goes to e2e-out/logcat.txt). */
export function logcatTail(lines = 120) {
	const all = adb(['logcat', '-d', '-v', 'time'], { soft: true, timeout: 60_000 });
	const keep = all.split('\n').filter((l) => /chromium|Capacitor|qinqin|WebView|ServiceWorker|AndroidRuntime|FATAL/i.test(l));
	console.log(`--- logcat (last ${lines} relevant lines of ${keep.length})\n${keep.slice(-lines).join('\n')}`);
	return all;
}
