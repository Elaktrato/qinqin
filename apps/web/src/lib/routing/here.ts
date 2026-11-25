// The app path the browser shows now (path and query), for "come back here"
// links: a session's Back, the study modal's Advanced settings. "/" outside a
// browser.

export function here(): string {
	if (typeof location === 'undefined') return '/';
	return `${location.pathname}${location.search}`;
}

/** safeFrom: `raw` when it is a path of this app ("/…", not "//…"), else "/". */
export function safeFrom(raw: string | null | undefined): string {
	return typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/';
}
