// The emulator check of #283: no window title ("qinqin") or action bar above the web app. Pure, so it is
// unit-tested (chrome.test.mjs); the driver feeds it a `uiautomator dump` and `dumpsys window`.
//
// Where the WebView may start: Capacitor 8's SystemBars plugin lets the page paint under the status bar (WebView at
// y = 0, the page clears the bars with env(safe-area-inset-*)) only on WebView 140+ with `viewport-fit=cover`
// (both of our pages have it); on an older WebView it pads the window by the system bar insets, so the WebView
// starts right under the status bar (Chromium bug 40699457). Either is right. A window title adds its height
// (about 56 dp) below that, so the check is: no title or action bar node in the app's package, and the WebView's
// top at or above the status bar's bottom.

const BAR_IDS = ['android:id/title', 'android:id/title_container', 'android:id/action_bar', 'android:id/action_bar_container'];
const BAR_CLASS = /(^|\.)(Toolbar|ActionBar[A-Za-z]*)$/;
const BOUNDS = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

/** attrs parses the attributes of one <node ...> tag. */
function attrs(tag) {
	const out = {};
	for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
	return out;
}

/** topBand: the bottom of a frame that is a band along the top edge (top 0, wider than tall), else null. */
function topBand(left, top, right, bottom) {
	return top === 0 && right - left > bottom - top && bottom > 0 ? bottom : null;
}

/**
 * statusBarBottom: the bottom edge, in px, of the status bar (and a top display cutout, which Capacitor pads for
 * too), from `dumpsys window` (InsetsSource lines: `type=statusBars frame=[0,0][1080,128]`, before Android 12
 * `type=ITYPE_STATUS_BAR`) or, when the dump holds the system UI's window, its `status_bar` node. Null when
 * neither says.
 */
export function statusBarBottom(dumpsys, xml = '') {
	let best = null;
	const take = (b) => {
		if (b !== null && (best === null || b > best)) best = b;
	};
	for (const m of dumpsys.matchAll(/type=(?:statusBars|ITYPE_STATUS_BAR|displayCutout|ITYPE_TOP_DISPLAY_CUTOUT)\b[^\n]*?frame=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/g)) {
		take(topBand(+m[1], +m[2], +m[3], +m[4]));
	}
	for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
		const a = attrs(m[0]);
		if (a['resource-id'] !== 'com.android.systemui:id/status_bar') continue;
		const b = BOUNDS.exec(a.bounds || '');
		if (b) take(topBand(+b[1], +b[2], +b[3], +b[4]));
	}
	return best;
}

/**
 * windowChrome: { ok, webViewTop, statusBarBottom, titles, reason } for a uiautomator dump. `titles` lists every
 * title or action bar node of the package as `<id or class> "<text>" <bounds>`; `webViewTop` is the top of the
 * first WebView (null when there is none).
 */
export function windowChrome(xml, pkg, barBottom) {
	const titles = [];
	let webViewTop = null;
	for (const m of xml.matchAll(/<node\b[^>]*>/g)) {
		const a = attrs(m[0]);
		if (a.package !== pkg) continue;
		const id = a['resource-id'] || '';
		const cls = a.class || '';
		if (BAR_IDS.includes(id) || id === `${pkg}:id/action_bar` || id === `${pkg}:id/action_bar_container` || BAR_CLASS.test(cls)) {
			titles.push(`${id || cls} "${a.text || ''}" ${a.bounds || ''}`);
		}
		if (webViewTop === null && cls === 'android.webkit.WebView') {
			const b = BOUNDS.exec(a.bounds || '');
			if (b) webViewTop = Number(b[2]);
		}
	}
	let reason = '';
	if (titles.length) reason = 'a title or action bar view';
	else if (webViewTop === null) reason = 'no WebView in the dump';
	else if (barBottom === null || barBottom === undefined) reason = 'the status bar height is unknown';
	else if (webViewTop > barBottom) reason = `the WebView starts ${webViewTop - barBottom} px below the status bar`;
	return { ok: reason === '', webViewTop, statusBarBottom: barBottom ?? null, titles, reason };
}
