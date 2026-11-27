// The emulator check of #283: the app's window has no title or action bar, and the WebView starts at the top.
import { describe, expect, it } from 'vitest';
import { windowChrome } from './chrome.mjs';

const PKG = 'io.github.elaktrato.qinqin';
const node = (attrs) =>
	`<node ${Object.entries({ text: '', 'resource-id': '', class: 'android.widget.FrameLayout', package: PKG, bounds: '[0,0][1080,2400]', ...attrs })
		.map(([k, v]) => `${k}="${v}"`)
		.join(' ')}>`;
const dump = (...nodes) => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${nodes.join('')}</hierarchy>`;

describe('windowChrome', () => {
	it('passes a WebView at the top and no title', () => {
		const r = windowChrome(dump(node({}), node({ class: 'android.webkit.WebView', bounds: '[0,0][1080,2400]' }), node({ class: 'android.widget.TextView', text: 'qinqin', bounds: '[40,300][400,360]' })), PKG);
		expect(r).toEqual({ ok: true, webViewTop: 0, titles: [] });
	});
	it('fails on the framework window title, with the WebView pushed down', () => {
		const r = windowChrome(
			dump(node({ 'resource-id': 'android:id/title', class: 'android.widget.TextView', text: 'qinqin', bounds: '[0,63][1080,210]' }), node({ class: 'android.webkit.WebView', bounds: '[0,210][1080,2400]' })),
			PKG
		);
		expect(r.ok).toBe(false);
		expect(r.webViewTop).toBe(210);
		expect(r.titles).toEqual(['android:id/title "qinqin" [0,63][1080,210]']);
	});
	it('fails on an AppCompat action bar or a toolbar', () => {
		for (const n of [node({ 'resource-id': `${PKG}:id/action_bar` }), node({ class: 'androidx.appcompat.widget.Toolbar' }), node({ 'resource-id': 'android:id/action_bar' })]) {
			expect(windowChrome(dump(n, node({ class: 'android.webkit.WebView' })), PKG).ok).toBe(false);
		}
	});
	it('ignores other packages (the system UI) and fails without a WebView', () => {
		const sysui = node({ package: 'com.android.systemui', 'resource-id': 'android:id/title', text: '12:00' });
		expect(windowChrome(dump(sysui, node({ class: 'android.webkit.WebView' })), PKG).ok).toBe(true);
		expect(windowChrome(dump(node({})), PKG)).toEqual({ ok: false, webViewTop: null, titles: [] });
	});
});
