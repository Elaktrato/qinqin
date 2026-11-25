// Page-level helpers of the emulator driver (#37): finding elements by what a person sees, real input through the
// DevTools Input domain (mouse, keys, IME composition) and through Android itself (adb touch), the touch calibration
// that maps CSS pixels to screen pixels, and a collector for uncaught errors. No Playwright.
import { adb, sleep, waitFor } from './lib.mjs';

const J = (s) => JSON.stringify(s);

/** The visible bottom bar / drawer navigation (the desktop bar is another `nav` named Main, hidden on a phone). */
export const NAV = "[...document.querySelectorAll('nav[aria-label=Main]')].find((n) => n.getClientRects().length > 0)";

export const bodyText = (cdp) => cdp.eval('document.body ? document.body.innerText : ""');

/** JS expressions (strings) that evaluate to an element or null; the visible one whose name starts with `label`. */
export const find = {
	/** A button, link or role=button/link/menuitem/tab by accessible name (aria-label, else text), prefix match. */
	named: (label, scope = 'button, a, [role=button], [role=link], [role=menuitem], [role=menuitemradio], [role=tab], summary') =>
		`[...document.querySelectorAll(${J(scope)})].find((x) => ((x.getAttribute('aria-label') || x.textContent || '').trim().startsWith(${J(label)})) && !x.disabled && x.getAttribute('aria-disabled') !== 'true' && x.getClientRects().length > 0)`,
	/** The first visible match of a CSS selector. */
	css: (sel) => `[...document.querySelectorAll(${J(sel)})].find((x) => x.getClientRects().length > 0)`,
	/** An input/textarea by its accessible name (label text or aria-label), prefix match. */
	field: (label) =>
		`[...document.querySelectorAll('input, textarea')].find((x) => x.getClientRects().length > 0 && ((x.getAttribute('aria-label') || [...(x.labels || [])].map((l) => l.textContent).join(' ') || x.placeholder || '').trim().startsWith(${J(label)})))`,
	/** An element carrying a dialog role whose name or text starts with `label`. */
	dialog: (label) =>
		`[...document.querySelectorAll('[role=dialog], dialog[open]')].find((x) => x.getClientRects().length > 0 && ((x.getAttribute('aria-label') || '') + ' ' + x.textContent).includes(${J(label)}))`
};

/** The box of an element in CSS px after scrolling it to the middle; null when absent. */
export async function boxOf(cdp, finder) {
	return cdp.eval(`(() => { const el = ${finder}; if (!el) return null; el.scrollIntoView({ block: 'center', inline: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()`);
}

/** A real mouse click (trusted events through the DevTools Input domain) at the element's centre. */
export async function click(cdp, finder, { timeout = 15_000 } = {}) {
	const found = await waitFor(`an element to click: ${finder.slice(0, 90)}`, () => boxOf(cdp, finder), { timeout, interval: 250 });
	await sleep(120); // a scroll or an animation may still be moving it
	const b = (await boxOf(cdp, finder)) || found;
	const x = b.x + b.w / 2;
	const y = b.y + b.h / 2;
	await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
	await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
	await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
	return b;
}

export const clickNamed = (cdp, label, opts) => click(cdp, find.named(label), opts);

/** Focuses a field the way a person does (click) and returns it focused. */
export async function focusField(cdp, finder) {
	await click(cdp, finder);
	const ok = await waitFor('the field to be focused', () => cdp.eval(`document.activeElement === (${finder})`), { timeout: 5000, interval: 100 });
	return ok;
}

const KEYS = {
	Enter: { vk: 13, text: '\r', code: 'Enter' },
	Escape: { vk: 27, code: 'Escape' },
	Backspace: { vk: 8, code: 'Backspace' },
	Tab: { vk: 9, code: 'Tab' },
	z: { vk: 90, text: 'z', code: 'KeyZ' }
};

/** press: a key down and up through the DevTools Input domain. `vk: 229` imitates a soft keyboard's "Process" key. */
export async function press(cdp, key, { vk, modifiers = 0 } = {}) {
	const k = KEYS[key] || { vk: key.toUpperCase().charCodeAt(0), text: key, code: `Key${key.toUpperCase()}` };
	const common = { key: vk === 229 ? 'Process' : key, code: k.code, windowsVirtualKeyCode: vk ?? k.vk, nativeVirtualKeyCode: vk ?? k.vk, modifiers };
	await cdp.send('Input.dispatchKeyEvent', { type: k.text && vk !== 229 ? 'keyDown' : 'rawKeyDown', ...common, ...(k.text && vk !== 229 ? { text: k.text } : {}) });
	await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common });
}

/** typeText: inserts text into the focused element as one committed input (no composition). */
export const typeText = (cdp, text) => cdp.send('Input.insertText', { text });

/** compose: the IME's pre-edit string (underlined text) in the focused element; compositionstart/update fire. */
export const compose = (cdp, text) => cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });

/** commit: ends the composition with `text` (compositionend + input), as choosing a candidate does. */
export const commit = (cdp, text) => cdp.send('Input.insertText', { text });

/** A recorder of composition and key events on the page, readable with imeLog(). */
export async function watchIme(cdp) {
	await cdp.eval(`(() => {
		window.__ime = [];
		if (window.__imeWatching) return;
		window.__imeWatching = true;
		for (const t of ['compositionstart', 'compositionupdate', 'compositionend']) addEventListener(t, (e) => __ime.push({ t, data: e.data }), true);
		addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.keyCode === 229 || e.key === 'Process') __ime.push({ t: 'keydown', key: e.key, keyCode: e.keyCode, isComposing: e.isComposing }); }, true);
	})()`);
}
export const imeLog = (cdp) => cdp.eval('window.__ime || []');

export const where = (cdp) => cdp.eval('({ path: location.pathname, search: location.search, href: location.href })');

/** waitText: waits until the page text matches `re`; returns the match. */
export const waitText = (cdp, re, { timeout = 20_000 } = {}) =>
	waitFor(`the text ${re}`, async () => (await bodyText(cdp)).match(re), { timeout, interval: 300 });

/** collectErrors: uncaught exceptions and console.error calls of the page, from now on. */
export async function collectErrors(cdp) {
	const list = [];
	cdp.on('Runtime.exceptionThrown', (p) => list.push(`exception: ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`));
	cdp.on('Runtime.consoleAPICalled', (p) => {
		if (p.type !== 'error') return;
		const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
		if (!/Failed to load resource|net::ERR|favicon/i.test(text)) list.push(`console.error: ${text}`);
	});
	await cdp.send('Runtime.enable');
	return list;
}

// ---- Android touch: real events through the input subsystem -------------------------------------------------

/**
 * calibrate: maps CSS px to screen px. A transparent full-screen overlay catches one adb tap at a known screen
 * point; the pointer's clientX/Y tell where the WebView is (status bar, display cutout) and the scale.
 */
export async function calibrate(cdp) {
	let c = null;
	for (let attempt = 0; attempt < 3 && !c; attempt++) {
		adb(['shell', 'am', 'broadcast', '-a', 'android.intent.action.CLOSE_SYSTEM_DIALOGS'], { soft: true });
		await cdp.eval(`(() => {
			document.getElementById('__cal')?.remove();
			const d = document.createElement('div'); d.id = '__cal'; d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:transparent;touch-action:none';
			window.__cal = null;
			d.addEventListener('pointerdown', (e) => { window.__cal = { x: e.clientX, y: e.clientY, dpr: devicePixelRatio }; }, true);
			document.body.appendChild(d);
		})()`);
		await sleep(500);
		adb(['shell', 'input', 'tap', '300', '900']);
		c = await waitFor('the calibration tap', () => cdp.eval('window.__cal'), { timeout: 5_000, interval: 200 }).catch(() => null);
	}
	await cdp.eval('document.getElementById("__cal")?.remove()');
	if (!c) throw new Error('the calibration tap never reached the page (a system dialog in front?)');
	return { dpr: c.dpr, ox: Math.round(300 - c.x * c.dpr), oy: Math.round(900 - c.y * c.dpr), size: await cdp.eval('({ w: innerWidth, h: innerHeight, sw: screen.width, sh: screen.height })') };
}

/** toScreen: CSS px (viewport) to screen px. */
export const toScreen = (cal, x, y) => [Math.round(cal.ox + x * cal.dpr), Math.round(cal.oy + y * cal.dpr)];

/** swipe: one straight touch stroke between two viewport points (down, moves, up) lasting `ms`. */
export function swipe(cal, from, to, ms = 300) {
	const [x1, y1] = toScreen(cal, from.x, from.y);
	const [x2, y2] = toScreen(cal, to.x, to.y);
	adb(['shell', 'input', 'swipe', String(x1), String(y1), String(x2), String(y2), String(ms)]);
}

/** stroke: a touch path through several viewport points held down the whole time (input motionevent in one shell). */
export function stroke(cal, points) {
	const pts = points.map((p) => toScreen(cal, p.x, p.y));
	const cmd = pts.map(([x, y], i) => `input motionevent ${i === 0 ? 'DOWN' : i === pts.length - 1 ? 'UP' : 'MOVE'} ${x} ${y}`).join('; ');
	adb(['shell', cmd]);
}

export const tap = (cal, p) => adb(['shell', 'input', 'tap', ...toScreen(cal, p.x, p.y).map(String)]);

/** The BACK key: the system back button (the shell hands it to the page, which decides). */
export const back = () => adb(['shell', 'input', 'keyevent', 'KEYCODE_BACK']);

/** The resumed activity, or "" when the app is not in front. */
export function resumedActivity() {
	const out = adb(['shell', 'dumpsys', 'activity', 'activities'], { soft: true, timeout: 60_000 });
	const line = out.split('\n').find((l) => /mResumedActivity|topResumedActivity/.test(l));
	return line ? line.trim() : '';
}
