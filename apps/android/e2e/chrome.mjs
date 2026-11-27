// The emulator check of #283: no window title ("qinqin") or action bar above the web app. Reads a `uiautomator
// dump` of the screen: in the app's own package, no node may be the framework's window title or action bar, an
// AppCompat action bar or a toolbar, and the WebView must start at the top of the window (edge to edge, y = 0,
// under the transparent status bar). Pure, so it is unit-tested (chrome.test.mjs); the driver feeds it the dump.

const BAR_IDS = ['android:id/title', 'android:id/title_container', 'android:id/action_bar', 'android:id/action_bar_container'];
const BAR_CLASS = /(^|\.)(Toolbar|ActionBar[A-Za-z]*)$/;

/** attrs parses the attributes of one <node ...> tag. */
function attrs(tag) {
	const out = {};
	for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
	return out;
}

/**
 * windowChrome: { ok, webViewTop, titles } for a uiautomator dump. `titles` lists every title or action bar node
 * of the package as `<id or class> "<text>" <bounds>`; `webViewTop` is the top of the first WebView (null when
 * there is none). ok: no titles and a WebView at y = 0.
 */
export function windowChrome(xml, pkg) {
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
			const b = /^\[(-?\d+),(-?\d+)\]/.exec(a.bounds || '');
			if (b) webViewTop = Number(b[2]);
		}
	}
	return { ok: titles.length === 0 && webViewTop === 0, webViewTop, titles };
}
