// Helpers of the emulator job (#35): adb, a dependency-free Chrome DevTools Protocol client over Node's global
// WebSocket, and a step recorder that prints a machine-readable summary. No Playwright, no `ws`.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const PKG = process.env.E2E_PACKAGE || 'io.github.elaktrato.qinqin';
export const OUT = process.env.E2E_OUT || join(process.cwd(), 'e2e-out');
mkdirSync(OUT, { recursive: true });
const ADB = process.env.ADB || 'adb';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** adb: runs `adb <args>`; returns trimmed stdout. A failing command throws unless `soft`. */
export function adb(args, { soft = false, timeout = 120_000 } = {}) {
	try {
		return execFileSync(ADB, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
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

export function screenshot(name) {
	try {
		const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 });
		writeFileSync(join(OUT, `${name}.png`), png);
	} catch {
		// A missing screenshot never fails a step.
	}
}

export function appPid() {
	const out = adb(['shell', 'pidof', PKG], { soft: true });
	return /^\d+/.test(out) ? out.split(/\s+/)[0] : null;
}

export class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 1;
		this.pending = new Map();
		ws.addEventListener('message', (ev) => {
			const msg = JSON.parse(ev.data);
			const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
			if (!p) return;
			this.pending.delete(msg.id);
			if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
			else p.resolve(msg.result);
		});
		ws.addEventListener('close', () => {
			for (const p of this.pending.values()) p.reject(new Error('DevTools socket closed'));
			this.pending.clear();
		});
	}

	send(method, params = {}) {
		const id = this.next++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject, method });
			this.ws.send(JSON.stringify({ id, method, params }));
			setTimeout(() => {
				if (this.pending.delete(id)) reject(new Error(`${method}: no answer in 60 s`));
			}, 60_000);
		});
	}

	/** eval: the value of a JS expression in the page (promises awaited, result by value). */
	async eval(expression) {
		const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		if (r.exceptionDetails) throw new Error(`page exception: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
		return r.result.value;
	}

	close() {
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
			return new Cdp(ws);
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
	}

	async step(name, fn) {
		const t0 = Date.now();
		const entry = { name, ok: false, ms: 0 };
		this.steps.push(entry);
		console.log(`--- ${name}`);
		try {
			const data = await fn();
			entry.ok = true;
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

	summary() {
		return { ok: !this.failed && this.steps.every((s) => s.ok), steps: this.steps, numbers: this.numbers };
	}

	write() {
		const text = JSON.stringify(this.summary());
		writeFileSync(join(OUT, 'summary.json'), JSON.stringify(this.summary(), null, 2));
		console.log(`SUMMARY ${text}`);
	}
}
