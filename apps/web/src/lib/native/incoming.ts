// What reaches the app from outside: a text another app shared ("Share" > qinqin), a text selected elsewhere
// ("Look up in qinqin") and the route of a tapped notification. The shell queues them (QinqinShare); this module
// takes them, checks them again (the text is untrusted: plain text, 200 characters, only ever a search query;
// a route must be an in-app path) and opens them once the web app is ready (signed in, workspaces loaded).
import { sharePlugin } from './share';

const MAX_TEXT = 200;
const MAX_ROUTE = 500;

/** cleanSharedText: control characters dropped, whitespace collapsed, at most 200 characters; null when nothing is left. */
export function cleanSharedText(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	let s = raw.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
	if (s.length > MAX_TEXT) {
		let end = MAX_TEXT;
		const last = s.charCodeAt(end - 1);
		if (last >= 0xd800 && last <= 0xdbff) end -= 1;
		s = s.slice(0, end).trim();
	}
	return s === '' ? null : s;
}

/** lookupHref: the search page with the text as its query; null for nothing usable. */
export function lookupHref(raw: unknown): string | null {
	const s = cleanSharedText(raw);
	return s === null ? null : `/search?q=${encodeURIComponent(s)}`;
}

/** routeHref: an in-app path (one leading slash, printable ASCII, not the API); null otherwise. */
export function routeHref(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_ROUTE) return null;
	if (!/^\/[\x21-\x7e]*$/.test(raw) || raw.startsWith('//') || raw.includes('\\')) return null;
	if (raw === '/api' || raw.startsWith('/api/') || raw.startsWith('/api?')) return null;
	return raw;
}

export interface IncomingDeps {
	/** True once the app can show a page for the person (signed in, workspaces loaded). */
	ready(): boolean;
	/** Opens an in-app address. */
	open(href: string): void;
}

export interface IncomingHandle {
	/** Opens what is queued if the app is ready now. */
	poke(): void;
	stop(): void;
}

/** startIncoming takes what the shell queued (now, and whenever something arrives) and opens it when ready. */
export function startIncoming(deps: IncomingDeps): IncomingHandle {
	const shell = sharePlugin();
	if (shell === null) return { poke: () => undefined, stop: () => undefined };
	let queued: string | null = null;
	let stopped = false;

	const poke = (): void => {
		if (queued === null || !deps.ready()) return;
		const href = queued;
		queued = null;
		deps.open(href);
	};
	const take = async (): Promise<void> => {
		try {
			const { items } = await shell.takeIncoming();
			if (stopped) return;
			// Only the newest thing counts: three shares in a row open the last one.
			for (const item of items) {
				const href = item.kind === 'text' ? lookupHref(item.value) : item.kind === 'route' ? routeHref(item.value) : null;
				if (href !== null) queued = href;
			}
			poke();
		} catch {
			// the shell has none: nothing arrived
		}
	};

	let listener: { remove(): Promise<void> } | null = null;
	void Promise.resolve(shell.addListener('incoming', () => void take()))
		.then((l) => {
			if (stopped) void l.remove();
			else listener = l;
		})
		.catch(() => undefined);
	void take();
	return {
		poke,
		stop() {
			stopped = true;
			void listener?.remove().catch(() => undefined);
		}
	};
}
