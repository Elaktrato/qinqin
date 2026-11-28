// The emulator check of #283: no title or action bar, and the WebView starts at or above the status bar's bottom.
import { describe, expect, it } from 'vitest';
import { statusBarBottom, windowChrome } from './chrome.mjs';

const PKG = 'io.github.elaktrato.qinqin';
const node = (attrs) =>
	`<node ${Object.entries({ text: '', 'resource-id': '', class: 'android.widget.FrameLayout', package: PKG, bounds: '[0,0][1080,2400]', ...attrs })
		.map(([k, v]) => `${k}="${v}"`)
		.join(' ')}>`;
const dump = (...nodes) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${nodes.join('')}</hierarchy>`;
const webView = (top) => node({ class: 'android.webkit.WebView', 'resource-id': `${PKG}:id/webview`, bounds: `[0,${top}][1080,2337]` });
const content = node({ class: 'android.widget.TextView', text: 'qinqin', bounds: '[40,300][400,360]' }); // the page's own heading

// What `dumpsys window` prints on API 34 (Pixel 6, 2.625x, a top cutout): the status bar is 128 px.
const DUMPSYS_34 = `
  InsetsStateController
    InsetsSource id=3 type=statusBars frame=[0,0][1080,128] visible=true mInsetsRoundedCornerFrame=false
    InsetsSource id=5 type=navigationBars frame=[0,2337][1080,2400] visible=true mInsetsRoundedCornerFrame=false
    InsetsSource id=7 type=displayCutout frame=[0,0][1080,118] visible=true
    InsetsSource id=9 type=displayCutout frame=[0,0][0,2400] visible=true
`;
const DUMPSYS_30 = `    InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,63] visible=true\n    InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2274][1080,2400] visible=true`;

describe('statusBarBottom', () => {
	it('reads the status bar (and a top cutout) from dumpsys window, ignoring side and bottom bars', () => {
		expect(statusBarBottom(DUMPSYS_34)).toBe(128);
		expect(statusBarBottom(DUMPSYS_30)).toBe(63);
	});
	it('falls back to the system UI status bar node of a dump', () => {
		expect(statusBarBottom('', dump(node({ package: 'com.android.systemui', 'resource-id': 'com.android.systemui:id/status_bar', bounds: '[0,0][1080,136]' })))).toBe(136);
	});
	it('is null when nothing says', () => {
		expect(statusBarBottom('nothing here', dump(node({})))).toBeNull();
	});
});

describe('windowChrome', () => {
	const bar = statusBarBottom(DUMPSYS_34);
	it('passes edge to edge: the WebView at 0, under the status bar (WebView 140+)', () => {
		expect(windowChrome(dump(node({}), webView(0), content), PKG, bar)).toMatchObject({ ok: true, webViewTop: 0, statusBarBottom: 128, titles: [] });
	});
	it('passes the padded layout: the WebView right under the status bar (older WebView; the CI run of PR #344)', () => {
		expect(windowChrome(dump(node({}), webView(128), content), PKG, bar)).toMatchObject({ ok: true, webViewTop: 128 });
	});
	it('fails on a title-height gap below the status bar, even without a title node', () => {
		const r = windowChrome(dump(node({}), webView(128 + 147)), PKG, bar);
		expect(r.ok).toBe(false);
		expect(r.reason).toBe('the WebView starts 147 px below the status bar');
	});
	it('fails on the framework window title', () => {
		const r = windowChrome(dump(node({ 'resource-id': 'android:id/title', class: 'android.widget.TextView', text: 'qinqin', bounds: '[0,128][1080,275]' }), webView(275)), PKG, bar);
		expect(r.ok).toBe(false);
		expect(r.titles).toEqual(['android:id/title "qinqin" [0,128][1080,275]']);
	});
	it('fails on a title node even when the WebView is at the top', () => {
		expect(windowChrome(dump(node({ 'resource-id': 'android:id/title', text: 'qinqin', bounds: '[0,0][1080,147]' }), webView(0)), PKG, bar).ok).toBe(false);
	});
	it('fails on an AppCompat action bar or a toolbar', () => {
		for (const n of [node({ 'resource-id': `${PKG}:id/action_bar` }), node({ class: 'androidx.appcompat.widget.Toolbar' }), node({ 'resource-id': 'android:id/action_bar' })]) {
			expect(windowChrome(dump(n, webView(128)), PKG, bar).ok).toBe(false);
		}
	});
	it('ignores other packages (the system UI)', () => {
		const sysui = node({ package: 'com.android.systemui', 'resource-id': 'android:id/title', text: '12:00' });
		expect(windowChrome(dump(sysui, webView(128)), PKG, bar).ok).toBe(true);
	});
	it('fails without a WebView, and when the status bar height is unknown', () => {
		expect(windowChrome(dump(node({})), PKG, bar)).toMatchObject({ ok: false, webViewTop: null, reason: 'no WebView in the dump' });
		expect(windowChrome(dump(webView(128)), PKG, null)).toMatchObject({ ok: false, reason: 'the status bar height is unknown' });
	});
});
