// The emulator job's driver (#35): runs against a booted emulator with the debug APK built, drives the real app
// through adb and the WebView's DevTools socket, and prints a JSON summary (also e2e-out/summary.json).
//
//   E2E_BIN=<qinqin binary> E2E_APK=<app-debug.apk> node apps/android/e2e/drive.mjs
//
// It starts its own server on 127.0.0.1:E2E_PORT (default 8085, reached by the emulator through `adb reverse`, so
// the app's address is http://localhost:8085: a private http address, and a secure context for the service worker),
// seeds a learner with four cards, and walks: first-run screen, address, web app, bridge, service worker, offline
// preparation, storage numbers, airplane mode + server down, cold start from the cache, an offline study session,
// a restart with unsent reviews, going online, and the exactly-once check on the server (and after two more restarts).
// Passwords are generated per run and live only in this process and the throw-away data directory.
//
// Suites (#37), chosen by E2E_SUITES (comma list; default: all): `shell` = the offline, native-feature and storage
// steps of #35/#36; `core` = sign in through the UI, a study session with Back, a reader lookup, the bottom bar
// and the back button (suites/core.mjs); `pages` = every route in Day and Night with layout invariants and
// screenshots (suites/pages.mjs); `ime` = composition in search, a typing card, the journal (suites/ime.mjs);
// `touch` = the writing pad and the tone pad under real adb touches (suites/touch.mjs); `perf` = the numbers for
// the design doc (suites/perf.mjs). Every run does the setup and the first sign-in; `core` and later suites run
// as a second learner so that the shell suite's reviews and offline state do not interfere.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, createWriteStream, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PKG, OUT, Recorder, adb, appPid, connectPage, gmsSettled, logcatTail, screenshot, sleep, waitFor } from './lib.mjs';
import { strokesPack } from './suites/common.mjs';
import * as core from './suites/core.mjs';
import * as pages from './suites/pages.mjs';
import * as ime from './suites/ime.mjs';
import * as touch from './suites/touch.mjs';
import * as perf from './suites/perf.mjs';

const ALL_SUITES = ['shell', 'core', 'pages', 'ime', 'touch', 'perf'];
const SUITES = new Set((process.env.E2E_SUITES || ALL_SUITES.join(',')).split(',').map((x) => x.trim()).filter(Boolean));

const BIN = resolve(process.env.E2E_BIN || '');
const APK = resolve(process.env.E2E_APK || '');
const PORT = Number(process.env.E2E_PORT || 8085);
const ORIGIN = `http://localhost:${PORT}`;
const HOST = `http://127.0.0.1:${PORT}`;
const REPO = resolve(new URL('../../..', import.meta.url).pathname);
const PACKS = join(REPO, 'apps/web/e2e/fixtures/packs');
const WORDS = ['私', '学校', '行く', '飲む'];
const GRADES = [
	['Again', 1],
	['Hard', 2],
	['Good', 3],
	['Easy', 4]
];
const FILL_CAP_MB = Number(process.env.E2E_FILL_CAP_MB || 1024);

const rec = new Recorder();
const num = rec.numbers;
const work = mkdtempSync(join(tmpdir(), 'qinqin-android-e2e-'));
const dataDir = join(work, 'data');
const emptyPacks = join(work, 'no-packs');
mkdirSync(emptyPacks);
const secret = randomBytes(32).toString('base64');
const newLearner = (tag, admin = false) => ({ tag, admin, username: `${tag}-${randomBytes(3).toString('hex')}`, password: `${randomBytes(12).toString('hex')}-Pw2!`, token: '', ws: {}, api: null });
// One learner per later suite, so their cards and reviews never meet: B (core, pages; an administrator so that the
// crawl reaches the admin pages), C (touch: pads), D (ime: a typing card), P (perf).
const learners = { B: newLearner('core', true), C: newLearner('touch'), D: newLearner('ime'), P: newLearner('perf') };
const username = `learner-${randomBytes(3).toString('hex')}`;
const password = `${randomBytes(12).toString('hex')}-Pw1!`;
const serverEnv = {
	PATH: process.env.PATH,
	HOME: process.env.HOME,
	QINQIN_AUTO_SEED: '0',
	QINQIN_PACKS: emptyPacks,
	QINQIN_AI_PROVIDER: 'fake',
	QINQIN_SECRET: secret
};

// ---- the server ----------------------------------------------------------------------------------------------
let server = null;
function startServer() {
	const log = createWriteStream(join(OUT, 'server.log'), { flags: 'a' });
	const proc = spawn(BIN, ['serve', '--addr', `127.0.0.1:${PORT}`, '--data', dataDir], { env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
	proc.stdout.pipe(log, { end: false });
	proc.stderr.pipe(log, { end: false });
	server = proc;
	return waitFor('the server', async () => (await fetch(`${HOST}/healthz`)).ok, { timeout: 60_000, interval: 200 });
}
async function stopServer() {
	if (!server || server.exitCode !== null) return;
	const exited = new Promise((r) => server.once('exit', r));
	try {
		process.kill(-server.pid, 'SIGTERM');
	} catch {
		// Already gone.
	}
	await Promise.race([exited, sleep(10_000)]);
}
process.on('exit', () => {
	try {
		if (server?.pid) process.kill(-server.pid, 'SIGKILL');
	} catch {
		// Gone.
	}
});

let token = '';
let wsId = 0;
async function api(path, body) {
	const res = await fetch(HOST + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
	return text === '' ? null : JSON.parse(text);
}
async function serverReviews() {
	const out = [];
	let path = `/api/events?limit=500&workspace=${wsId}`;
	for (;;) {
		const page = await api(path);
		out.push(...page.events.filter((e) => e.type === 'review'));
		if (!page.more || !page.next) return out;
		path = `/api/events?page=${encodeURIComponent(page.next)}&workspace=${wsId}`;
	}
}

// ---- the page ------------------------------------------------------------------------------------------------
const bodyText = (cdp) => cdp.eval('document.body ? document.body.innerText : ""');
const clickButton = (cdp, label, scope = 'button') =>
	cdp.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}) && !x.disabled); if (!b) return false; b.click(); return true; })()`);

const MEASURE = `(async () => {
	const e = await navigator.storage.estimate();
	const out = { quota: e.quota, usage: e.usage, usageDetails: e.usageDetails || null, persisted: await navigator.storage.persisted(), caches: [], idb: [], localStorageKeys: Object.keys(localStorage).length };
	for (const n of await caches.keys()) {
		const c = await caches.open(n); const ks = await c.keys(); let bytes = 0;
		for (const k of ks) { const r = await c.match(k); bytes += (await r.blob()).size; }
		out.caches.push({ entries: ks.length, bytes });
	}
	if (indexedDB.databases) out.idb = (await indexedDB.databases()).map((d) => d.name);
	return out;
})()`;
const SW_STATE = `(async () => {
	const regs = await navigator.serviceWorker.getRegistrations();
	return { secure: isSecureContext, controller: !!navigator.serviceWorker.controller, registrations: regs.map((r) => ({ scope: r.scope, active: r.active && r.active.state })), ua: navigator.userAgent, onLine: navigator.onLine };
})()`;
const FILL = (cap, chunk) => `(async () => {
	const c = await caches.open('e2e-fill'); const buf = new Uint8Array(${chunk} * 1048576).fill(7);
	let written = 0, error = null;
	try { for (let i = 0; written < ${cap}; i++) { await c.put('/e2e-fill/' + i, new Response(buf.slice())); written += ${chunk}; } }
	catch (e) { error = e.name + ': ' + e.message; }
	const est = await navigator.storage.estimate();
	await caches.delete('e2e-fill');
	const after = await navigator.storage.estimate();
	return { writtenMB: written, error, usageAtEnd: est.usage, quota: est.quota, usageAfterDelete: after.usage };
})()`;

// ---- the app -------------------------------------------------------------------------------------------------
function launch() {
	const t0 = Date.now();
	const out = adb(['shell', 'am', 'start', '-W', '-n', `${PKG}/qinqin.shell.MainActivity`]);
	const m = (k) => Number((out.match(new RegExp(`${k}: (\\d+)`)) || [])[1] ?? NaN);
	return { t0, totalTimeMs: m('TotalTime'), waitTimeMs: m('WaitTime') };
}
const forceStop = () => adb(['shell', 'am', 'force-stop', PKG]);
const airplane = (on) => {
	let out = adb(['shell', 'cmd', 'connectivity', 'airplane-mode', on ? 'enable' : 'disable'], { soft: true });
	if (out.startsWith('ERROR')) {
		adb(['shell', 'settings', 'put', 'global', 'airplane_mode_on', on ? '1' : '0'], { soft: true });
		out += ' | ' + adb(['shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', on ? 'true' : 'false'], { soft: true });
	}
	return out;
};

/** Relaunches the app (cold) and returns { cdp, totalTimeMs, renderMs }: renderMs = until the server's page has text. */
async function coldStart(label) {
	forceStop();
	await sleep(1500);
	const l = launch();
	const cdp = await connectPage(ORIGIN + '/', { timeout: 90_000 });
	await waitFor('the app to render', async () => (await bodyText(cdp)).trim().length > 40, { timeout: 60_000 });
	const renderMs = Date.now() - l.t0;
	num[`coldStart_${label}`] = { amStartTotalMs: l.totalTimeMs, amStartWaitMs: l.waitTimeMs, toRenderedPageMs: renderMs };
	return { cdp, ...l, renderMs };
}

let cdp = null;

async function main() {
	let cards = 0;

	await rec.step('server: seed packs, create a learner with four cards', async () => {
		// The fixture dictionaries plus a tiny generated strokes pack (two characters with two strokes each; the touch suite).
		const extraPacks = strokesPack(join(work, 'strokes-pack'));
		execFileSync(BIN, ['seed', '--data', dataDir, '--packs', [PACKS, ...extraPacks].join(',')], { env: serverEnv, stdio: 'pipe' });
		execFileSync(BIN, ['adduser', '--data', dataDir, '--username', username], { env: { ...serverEnv, QINQIN_PASSWORD: password }, stdio: 'pipe' });
		// The learners of the suites after `shell`.
		for (const l of Object.values(learners)) {
			execFileSync(BIN, ['adduser', '--data', dataDir, '--username', l.username, ...(l.admin ? ['--admin'] : [])], { env: { ...serverEnv, QINQIN_PASSWORD: l.password }, stdio: 'pipe' });
		}
		await startServer();
		const login = await (await fetch(`${HOST}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password, deviceName: 'android-e2e' }) })).json();
		if (login.status !== 'ok' || !login.token) throw new Error(`login: ${JSON.stringify({ ...login, token: undefined })}`);
		token = login.token;
		const list = await api('/api/workspaces');
		wsId = list.find((w) => w.language === 'ja').id;
		const now = Date.now();
		const rows = [];
		for (const [i, written] of WORDS.entries()) {
			const hits = await api(`/api/search?q=${encodeURIComponent(written)}&lang=ja`);
			const entryId = hits.find((h) => h.written === written)?.id;
			if (!entryId) throw new Error(`no entry for ${written}`);
			rows.push({ workspaceId: wsId, id: `c-vocab-${entryId}`, kind: 'vocab', entryId, written, entryKind: null, sentenceId: null, skipKinds: [], deckIds: ['general'], createdAt: new Date(now - 864e6 + i * 1000).toISOString(), extra: {}, updatedAt: new Date(now).toISOString(), deletedAt: null });
		}
		await api('/api/sync/push', { cards: rows, deckSettings: [], events: [] });
		cards = rows.length;
		await sleep(2500); // a pull round ships rows stamped before a whole second
		return { cards };
	});
	if (rec.failed) return;

	await rec.step('device: wait for Google Play services to settle (its restart kills apps)', async () => (num.gms = await gmsSettled()));

	await rec.step('device: reverse the port, install the debug APK, first launch', async () => {
		num.apiLevel = adb(['shell', 'getprop', 'ro.build.version.sdk']);
		adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
		adb(['install', '-r', '-t', APK], { timeout: 300_000 });
		// A busy software emulator shows "isn't responding" dialogs that swallow touches: do not show them.
		adb(['shell', 'settings', 'put', 'global', 'hide_error_dialogs', '1'], { soft: true });
		for (let attempt = 1; ; attempt++) {
			try {
				adb(['shell', 'pm', 'clear', PKG], { soft: true });
				const l = launch();
				num.coldStart_firstRun = { amStartTotalMs: l.totalTimeMs, amStartWaitMs: l.waitTimeMs, attempt };
				cdp = await connectPage('https://localhost/', { timeout: 90_000 });
				await waitFor('the first-run form', () => cdp.eval('!!document.getElementById("address") && document.getElementById("title").textContent.length > 0'), { timeout: 45_000 });
				num.coldStart_firstRun.bridge = await cdp.eval('typeof window.Capacitor !== "undefined" && window.Capacitor.isNativePlatform()');
				break;
			} catch (err) {
				if (attempt >= 3) throw err;
				console.log(`first launch failed (${err.message}); retrying once`);
				cdp?.close();
				forceStop();
				await sleep(5000);
			}
		}
		screenshot('01-first-run');
		return { ...num.coldStart_firstRun };
	});
	if (rec.failed) return;

	await rec.step('first-run screen: address entry, plain-http warning, Open', async () => {
		// The emulator image may kill the app here too (a Google Play services restart): start the screen anew, twice at most.
		for (let attempt = 1; ; attempt++) {
			try {
				await cdp.eval(`(() => { const i = document.getElementById("address"); i.value = ${JSON.stringify(ORIGIN)}; document.getElementById("form").requestSubmit(); })()`);
				await waitFor('the check to finish', () => cdp.eval('!!document.querySelector("#actions button.primary")'), { timeout: 30_000 });
				const notes = await cdp.eval('document.getElementById("notes").innerText');
				screenshot('02-address-checked');
				if (!/plain http|http/i.test(notes) || !/Found qinqin/.test(notes)) throw new Error(`unexpected notes: ${notes}`);
				await cdp.eval('document.querySelector("#actions button.primary").click()');
				cdp.close();
				const t0 = Date.now();
				cdp = await connectPage(ORIGIN + '/', { timeout: 90_000 });
				num.openToServerPageMs = Date.now() - t0;
				return { notes, attempt };
			} catch (err) {
				if (attempt >= 3 || !/socket closed|No page|not found/i.test(err.message)) throw err;
				console.log(`first-run screen failed (${err.message}); starting it again`);
				cdp?.close();
				forceStop();
				adb(['shell', 'pm', 'clear', PKG], { soft: true });
				await sleep(3000);
				launch();
				cdp = await connectPage('https://localhost/', { timeout: 90_000 });
				await waitFor('the first-run form', () => cdp.eval('!!document.getElementById("address")'), { timeout: 45_000 });
			}
		}
	});
	if (rec.failed) return;

	await rec.step('web app: loads on the server origin, Capacitor bridge present, secure context', async () => {
		await waitFor('the web app', async () => (await bodyText(cdp)).trim().length > 20, { timeout: 60_000 });
		screenshot('03-web-app');
		const r = await cdp.eval(`({ native: window.Capacitor?.isNativePlatform?.() === true, shell: typeof window.Capacitor?.Plugins?.QinqinShell, app: typeof window.Capacitor?.Plugins?.App, secure: isSecureContext, url: location.href })`);
		if (!r.native || !r.secure) throw new Error(JSON.stringify(r));
		return r;
	});
	if (rec.failed) return;

	await rec.step('sign in (token in localStorage), service worker registers and controls', async () => {
		await cdp.eval(`localStorage.setItem('qinqin.token', ${JSON.stringify(token)}); location.reload()`);
		await sleep(1500);
		await waitFor('the worker ready', () => cdp.eval('navigator.serviceWorker.ready.then(() => true)'), { timeout: 60_000 });
		await cdp.eval('location.reload()');
		await waitFor('the worker controlling', () => cdp.eval('navigator.serviceWorker.controller !== null'), { timeout: 30_000 });
		const sw = await cdp.eval(SW_STATE);
		num.serviceWorker = { registrations: sw.registrations.length, active: sw.registrations[0]?.active, controller: sw.controller };
		num.userAgent = sw.ua;
		return sw;
	});
	if (rec.failed) return;

	// ---- the suites -----------------------------------------------------------------------------------------------
	if (SUITES.has('shell')) await shellSuite();
	const later = ['core', 'pages', 'ime', 'touch', 'perf'].filter((n) => SUITES.has(n));
	if (later.length > 0) {
		await recoverOnline();
		const ctx = makeCtx();
		for (const [name, mod] of [['core', core], ['pages', pages], ['ime', ime], ['touch', touch], ['perf', perf]]) {
			if (!SUITES.has(name)) continue;
			ctx.suite = name;
			rec.startSuite();
			await mod.run(ctx);
			if (ctx.cdp !== cdp) cdp = ctx.cdp;
		}
	}
	cdp?.close();
}

/** The steps of #35/#36: native plugins, share-in, notification, storage, offline start and the offline session. */
async function shellSuite() {
	const recorded = [];
	// ---- native device features (#36): cheap, deterministic checks of the bridge pieces ------------------------
	await rec.step('native plugins: speech, files, share, notifications and the shell answer through the bridge', async () => {
		const r = await cdp.eval(`(async () => {
			const P = window.Capacitor.Plugins;
			const kinds = Object.fromEntries(['QinqinShell', 'QinqinSpeech', 'QinqinFiles', 'QinqinShare', 'QinqinNotifications'].map((n) => [n, typeof P[n]]));
			const zh = await P.QinqinSpeech.isAvailable({ lang: 'zh' });
			const ja = await P.QinqinSpeech.isAvailable({ lang: 'ja' });
			const perm = await P.QinqinNotifications.permission();
			const pending = await P.QinqinNotifications.pending();
			const buzz = await P.QinqinShell.vibrate({ ms: 20 });
			return { kinds, zh, ja, perm, pending, buzz };
		})()`);
		for (const [n, k] of Object.entries(r.kinds)) if (k === 'undefined') throw new Error(`${n} is missing: ${JSON.stringify(r)}`);
		if (typeof r.zh.available !== 'boolean' || typeof r.ja.available !== 'boolean') throw new Error(`speech answers: ${JSON.stringify(r)}`);
		if (!['granted', 'denied', 'prompt'].includes(r.perm.state) || !Array.isArray(r.pending.ids)) throw new Error(JSON.stringify(r));
		num.nativePlugins = r;
		return r;
	});

	await rec.step('share in: ACTION_SEND text/plain opens the lookup with that text', async () => {
		// One shell string: adb would split an argument with a space into two words.
		adb(['shell', `am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '你好 world' -n ${PKG}/qinqin.shell.MainActivity`]);
		const where = await waitFor('the lookup', async () => {
			const w = await cdp.eval('({ path: location.pathname, q: new URLSearchParams(location.search).get("q") })');
			return w.path === '/search' && w.q === '你好 world' ? w : false;
		}, { timeout: 30_000 });
		screenshot('04a-shared-text');
		return where;
	});

	await rec.step('share in: "Look up in qinqin" (ACTION_PROCESS_TEXT) opens the lookup', async () => {
		adb(['shell', 'am', 'start', '-a', 'android.intent.action.PROCESS_TEXT', '-t', 'text/plain', '--es', 'android.intent.extra.PROCESS_TEXT', '谢谢', '-n', `${PKG}/qinqin.shell.LookupAlias`]);
		return await waitFor('the lookup', async () => {
			const w = await cdp.eval('({ path: location.pathname, q: new URLSearchParams(location.search).get("q") })');
			return w.path === '/search' && w.q === '谢谢' ? w : false;
		}, { timeout: 30_000 });
	});

	await rec.step('local notification: granted, scheduled, posted by the alarm; a tap route opens the page', async () => {
		adb(['shell', 'pm', 'grant', PKG, 'android.permission.POST_NOTIFICATIONS'], { soft: true });
		// Doze and app standby may hold an inexact alarm for minutes on the emulator image: switch them off for this step.
		adb(['shell', 'dumpsys', 'deviceidle', 'disable'], { soft: true });
		adb(['shell', 'cmd', 'appops', 'set', PKG, 'RUN_ANY_IN_BACKGROUND', 'allow'], { soft: true });
		// Two things on the emulator can destroy a scheduled test notification before its alarm rings; the step rides
		// both out instead of sleeping and hoping:
		//  1. The web app's reminder scheduler (#137) calls cancelAll() once per page load after sign-in when the
		//     account has no reminders on. The device channel owns every local notification, so that is intended;
		//     the driver waits for that call (the bridge logs it) before it schedules its own.
		//  2. The emulator's GMS (com.google.android.gms.persistent) restarts itself to refresh its configuration a few
		//     seconds after the first check-in, and the OS then kills every app bound to its FontsProvider, ours
		//     included ("Killing ...: depends on provider ...FontsProvider in dying proc"). The relaunch replans
		//     (cancelAll) again, so a dead app means: relaunch, wait for that replan, schedule again.
		const cancelCalls = () => (adb(['logcat', '-d', '-s', 'Capacitor'], { soft: true, timeout: 60_000 }).match(/methodName: cancelAll/g) || []).length;
		const attempts = [];
		let shown = false;
		let left = null;
		for (let attempt = 1; attempt <= 3 && !shown; attempt++) {
			let alive = !!appPid();
			if (alive) {
				try {
					await cdp.send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, 10_000);
				} catch {
					alive = false;
				}
			}
			let base = 0; // the page that has been up since sign-in may have replanned already
			if (!alive) {
				cdp.close();
				launch();
				cdp = await connectPage(ORIGIN + '/', { timeout: 90_000 });
				await waitFor('the app to render', async () => (await bodyText(cdp)).trim().length > 40, { timeout: 60_000 });
				base = cancelCalls();
			}
			// No cancelAll within 40 s of a page load means none is coming.
			const replan = await waitFor('the reminder replan', () => cancelCalls() > base, { timeout: 40_000, interval: 1000 }).catch(() => false);
			await sleep(1500);
			attempts.push(`attempt ${attempt}: ${alive ? 'app alive' : 'app was dead, relaunched'}, replan seen: ${!!replan}`);
			const perm = await cdp.eval('window.Capacitor.Plugins.QinqinNotifications.permission()');
			if (perm.state !== 'granted') throw new Error(`permission: ${JSON.stringify(perm)}`);
			await cdp.eval(`window.Capacitor.Plugins.QinqinNotifications.schedule({ id: 4242, title: 'qinqin e2e reminder', body: 'ready', at: Date.now() + 4000, channel: { id: 'e2e', name: 'E2E' }, route: '/stats' })`);
			const pending = await cdp.eval('window.Capacitor.Plugins.QinqinNotifications.pending()');
			if (!pending.ids.includes(4242)) throw new Error(`not pending: ${JSON.stringify(pending)}`);
			const scheduledPid = appPid();
			const got = await waitFor('the notification', () => adb(['shell', 'dumpsys', 'notification', '--noredact'], { soft: true }).includes('qinqin e2e reminder') || (appPid() !== scheduledPid ? 'app-died' : false), { timeout: 60_000, interval: 2000 }).catch(() => false);
			shown = got === true;
			if (shown) left = await cdp.eval('window.Capacitor.Plugins.QinqinNotifications.pending()');
		}
		if (!shown) throw new Error(`timeout waiting for the notification (${attempts.join('; ')})`);
		adb(['shell', 'am', 'start', '-n', `${PKG}/qinqin.shell.MainActivity`, '--es', 'qinqin.shell.ROUTE', '/stats']);
		const at = await waitFor('the route', async () => ((await cdp.eval('location.pathname')) === '/stats' ? true : false), { timeout: 30_000 });
		return { shown, stillPending: left.ids, routed: at, attempts };
	});

	await rec.step('keep awake: the window flag is set while asked (informational)', async () => {
		await cdp.eval('window.Capacitor.Plugins.QinqinShell.keepAwake({ on: true })');
		await sleep(500);
		const on = adb(['shell', 'dumpsys window windows'], { soft: true }).includes('KEEP_SCREEN_ON');
		await cdp.eval('window.Capacitor.Plugins.QinqinShell.keepAwake({ on: false })');
		num.keepScreenOnFlagSeen = on;
		return { flagSeenInDumpsys: on };
	});

	await rec.step('offline preparation: settings page saves the cards (receipt line)', async () => {
		const t0 = Date.now();
		await cdp.eval("location.assign('/settings?tab=account')");
		const line = await waitFor('"Offline: ready"', async () => (await bodyText(cdp)).match(/Offline: ready - (\d+) cards? saved/)?.[0], { timeout: 90_000, interval: 1000 });
		num.prepareOfflineMs = Date.now() - t0;
		screenshot('04-offline-ready');
		return { line, ms: num.prepareOfflineMs };
	});

	await rec.step('storage: estimate, persisted(), persist(), cache contents', async () => {
		const before = await cdp.eval(MEASURE);
		const persistedByApp = before.persisted;
		const persistResult = await cdp.eval('navigator.storage.persist ? navigator.storage.persist() : "no persist()"');
		const after = await cdp.eval('navigator.storage.persisted()');
		const df = adb(['shell', 'df', '/data'], { soft: true });
		const r = { quotaBytes: before.quota, usageBytes: before.usage, usageDetails: before.usageDetails, persistedAfterAppStart: persistedByApp, persistCall: persistResult, persistedAfterCall: after, caches: before.caches, idb: before.idb, localStorageKeys: before.localStorageKeys, dataPartition: df.split('\n').slice(-1)[0] };
		num.storage = r;
		return r;
	});

	await rec.step('storage: write until the quota or the cap, then delete', async () => {
		const r = await cdp.eval(FILL(FILL_CAP_MB, 32));
		num.fill = r;
		const after = await cdp.eval(MEASURE);
		num.cachesAfterFill = after.caches;
		return { ...r, capMB: FILL_CAP_MB };
	});

	await rec.step('storage survives: force-stop, pm trim-caches, relaunch', async () => {
		let before;
		try {
			before = (await cdp.eval(MEASURE)).caches;
		} catch (err) {
			// The emulator image may have killed the app (a Google Play services restart): start it again and measure.
			num.storageSurvivesRelaunched = String(err.message);
			forceStop();
			cdp = (await coldStart('online')).cdp;
			before = (await cdp.eval(MEASURE)).caches;
		}
		cdp.close();
		forceStop();
		const trim = adb(['shell', 'pm', 'trim-caches', '9999999999999'], { soft: true });
		const c = await coldStart('online');
		cdp = c.cdp;
		const after = (await cdp.eval(MEASURE)).caches;
		const sum = (a) => a.reduce((s, x) => s + x.entries, 0);
		if (sum(after) < sum(before)) throw new Error(`entries before ${sum(before)}, after ${sum(after)}`);
		return { trim, entriesBefore: sum(before), entriesAfter: sum(after), coldStart: num.coldStart_online };
	});

	await rec.step('go offline: airplane mode on, server stopped', async () => {
		const a = airplane(true);
		await stopServer();
		await sleep(3000);
		let stillOnLine = await waitFor('navigator.onLine false', async () => (await cdp.eval('navigator.onLine')) === false, { timeout: 20_000 }).then(() => false, () => true);
		let fallback = null;
		if (stillOnLine) {
			// Airplane mode did not change what the WebView sees: try the radios directly.
			fallback = adb(['shell', 'svc', 'wifi', 'disable'], { soft: true }) + adb(['shell', 'svc', 'data', 'disable'], { soft: true });
			stillOnLine = await waitFor('navigator.onLine false', async () => (await cdp.eval('navigator.onLine')) === false, { timeout: 20_000 }).then(() => false, () => true);
		}
		num.airplane = { command: a, fallbackSvc: fallback, navigatorOnLineStillTrue: stillOnLine };
		const reachable = await fetch(`${HOST}/healthz`).then(() => true, () => false);
		if (reachable) throw new Error('server still reachable');
		// Toggling airplane mode makes Google Play services restart on the google_apis image, and the system then kills
		// every process that uses its fonts provider (the app too) about 20 s later (seen on the run of 2026-11-25:
		// an app kill during the offline session). The app is restarted below anyway; wait the crash out first.
		await sleep(45_000);
		return num.airplane;
	});

	await rec.step('offline cold start: the app opens from the service worker cache', async () => {
		cdp.close();
		const c = await coldStart('offline');
		cdp = c.cdp;
		const sw = await cdp.eval(SW_STATE);
		screenshot('05-offline-start');
		const text = await bodyText(cdp);
		if (!sw.controller) throw new Error('page not controlled by the worker');
		if (/Could not reach/.test(text)) throw new Error('the first-run error screen is showing');
		return { controller: sw.controller, onLine: sw.onLine, textStart: text.slice(0, 120), coldStart: num.coldStart_offline };
	});

	await rec.step('offline study session: four cards, one grade each', async () => {
		await cdp.eval("location.assign('/study')");
		await waitFor('Start studying', () => clickButton(cdp, 'Start studying'), { timeout: 60_000 });
		const seen = new Map();
		for (let shown = 0; shown < 12; shown++) {
			const state = await waitFor('a card or the end', async () => {
				const t = await bodyText(cdp);
				if (/Session complete/.test(t)) return 'done';
				return (await cdp.eval('!![...document.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Show answer"))')) ? 'card' : null;
			}, { timeout: 30_000, interval: 300 });
			if (state === 'done') break;
			const word = await cdp.eval(`(${JSON.stringify(WORDS)}).find((w) => (document.querySelector("article")?.innerText || "").includes(w)) || null`);
			if (!word) throw new Error('could not read the card word');
			const first = !seen.has(word);
			const [name, value] = first ? GRADES[seen.size] : ['Good', 3];
			if (first) {
				seen.set(word, value);
				recorded.push(value);
			}
			await clickButton(cdp, 'Show answer');
			await waitFor(`${name} button`, () => clickButton(cdp, name), { timeout: 15_000, interval: 200 });
		}
		if (seen.size !== WORDS.length) throw new Error(`only ${seen.size} words were graded`);
		const saved = await waitFor('the unsent-reviews line', async () => (await bodyText(cdp)).match(/(\d+) reviews? (?:are|is) saved on this device/)?.[0], { timeout: 15_000 });
		screenshot('06-offline-session-done');
		const onServer = (await fetch(`${HOST}/healthz`).then(() => true, () => false));
		if (onServer) throw new Error('server came back');
		return { graded: [...seen.entries()], saved };
	});

	await rec.step('restart offline with unsent reviews: the outbox survives', async () => {
		// Chromium commits localStorage to disk a few seconds after a write: an immediate force-stop lost 2 of the 4
		// unsent reviews on the first emulator run (recorded in the design doc), so a real kill is simulated after it.
		await sleep(8000);
		cdp.close();
		const c = await coldStart('offline_2');
		cdp = c.cdp;
		const saved = await waitFor('the unsent-reviews line', async () => (await bodyText(cdp)).match(/(\d+) reviews? (?:are|is) saved on this device/)?.[0], { timeout: 30_000 });
		if (!saved.startsWith(`${WORDS.length} `)) throw new Error(`the outbox kept ${saved}; ${WORDS.length} were graded`);
		return { saved };
	});

	await rec.step('back online: airplane mode off, server up, the outbox drains', async () => {
		airplane(false);
		adb(['shell', 'svc', 'wifi', 'enable'], { soft: true });
		adb(['shell', 'svc', 'data', 'enable'], { soft: true });
		await startServer();
		const t0 = Date.now();
		await waitFor('"All reviews sent."', async () => /All reviews sent\./.test(await bodyText(cdp)), { timeout: 60_000, interval: 1000 }).catch(async () => {
			// Not drained by the online event: opening the app flushes (the documented rule), so restart it.
			num.drainedWithoutRestart = false;
			cdp.close();
			cdp = (await coldStart('online_2')).cdp;
		});
		await waitFor('the server to hold the reviews', async () => (await serverReviews()).length >= WORDS.length, { timeout: 60_000, interval: 1000 });
		num.drainMs = Date.now() - t0;
		screenshot('07-online-sent');
		return { drainMs: num.drainMs };
	});

	const verify = async (label) => {
		const r = await serverReviews();
		const ids = new Set(r.map((e) => e.id));
		const cardIds = new Set(r.map((e) => e.payload.cardId));
		const grades = r.map((e) => e.payload.grade).sort();
		if (r.length !== WORDS.length || ids.size !== WORDS.length || cardIds.size !== WORDS.length) throw new Error(`${label}: ${r.length} events, ${ids.size} ids, ${cardIds.size} cards (want ${WORDS.length})`);
		if (JSON.stringify(grades) !== JSON.stringify([...recorded].sort())) throw new Error(`${label}: grades ${grades} differ from ${recorded}`);
		return { events: r.length, distinctIds: ids.size, grades };
	};
	await rec.step('exactly once: the server holds each review once', async () => (num.afterDrain = await verify('after drain')));

	for (const n of [1, 2]) {
		await rec.step(`restart ${n} (online): nothing is sent twice`, async () => {
			cdp.close();
			const c = await coldStart(`online_restart${n}`);
			cdp = c.cdp;
			await sleep(10_000); // the outbox flushes on open
			const text = await bodyText(cdp);
			if (/reviews? (?:are|is) saved on this device/.test(text)) throw new Error('an unsent-reviews line is showing');
			return await verify(`restart ${n}`);
		});
	}
}

/** After the shell suite: radios on, server up, the app cold-started online (the offline suite may have failed anywhere). */
async function recoverOnline() {
	await rec.step('recover: back online, server up, app restarted', async () => {
		airplane(false);
		adb(['shell', 'svc', 'wifi', 'enable'], { soft: true });
		adb(['shell', 'svc', 'data', 'enable'], { soft: true });
		if (!(await fetch(`${HOST}/healthz`).then((r) => r.ok, () => false))) await startServer();
		cdp?.close();
		cdp = (await coldStart('recovered')).cdp;
		return { online: await cdp.eval('navigator.onLine') };
	});
}

/** What the later suites share (suites/*.mjs). */
function makeCtx() {
	return {
		rec,
		num,
		suite: '',
		ORIGIN,
		HOST,
		PKG,
		learnerA: { username, password, token },
		learners,
		signedAs: null,
		get cdp() {
			return cdp;
		},
		set cdp(v) {
			cdp = v;
		},
		coldStart,
		launch,
		forceStop,
		airplane,
		startServer,
		api: (tok) => async (path, body) => {
			const res = await fetch(HOST + path, {
				method: body === undefined ? 'GET' : 'POST',
				headers: { authorization: `Bearer ${tok}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			const text = await res.text();
			if (!res.ok) throw new Error(`${path}: ${res.status} ${text.slice(0, 200)}`);
			return text === '' ? null : JSON.parse(text);
		},
		rawApi: (tok) => async (path, init = {}) => fetch(HOST + path, { ...init, headers: { authorization: `Bearer ${tok}`, ...(init.headers || {}) } })
	};
}

try {
	if (!process.env.E2E_BIN || !process.env.E2E_APK) throw new Error('set E2E_BIN and E2E_APK');
	await main();
} catch (err) {
	await rec.step('driver', async () => {
		throw err;
	});
} finally {
	try {
		airplane(false);
	} catch {
		// Leave the emulator as found.
	}
	const log = logcatTail(rec.failed ? 150 : 20);
	try {
		writeFileSync(join(OUT, 'logcat.txt'), log);
	} catch (err) {
		console.log(`cannot write ${OUT}: ${err.message}`);
	}
	await stopServer();
	console.log(`out dir: ${OUT}`);
	rec.write();
	process.exit(rec.summary().ok ? 0 : 1);
}
