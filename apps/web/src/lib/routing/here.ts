// The app path the browser shows now (path and query), for "come back here"
// links: a session's Back, the study modal's Advanced settings. "/" outside a
// browser.

export function here(): string {
	if (typeof location === 'undefined') return '/';
	return `${location.pathname}${location.search}`;
}

// Outside a browser (a unit test) paths resolve against a placeholder origin.
const NO_ORIGIN = 'http://qinqin.invalid';

/**
 * appPath: `raw` as a path of this app (path, query and hash), or null. A
 * value must start with one "/", hold no control character or backslash, and
 * resolve to this origin: "/\t/evil.example" and "//evil.example" resolve to
 * another host in a browser and are refused (review of 2026-11-25).
 */
export function appPath(raw: string | null | undefined): string | null {
	if (typeof raw !== 'string' || !raw.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(raw)) return null;
	const origin = typeof location === 'undefined' ? NO_ORIGIN : location.origin;
	try {
		const url = new URL(raw, origin);
		return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : null;
	} catch {
		return null;
	}
}

/** safeFrom: `raw` when it is a path of this app, else "/" (appPath). */
export function safeFrom(raw: string | null | undefined): string {
	return appPath(raw) ?? '/';
}
