// What the worker does with each class of request (see classify.ts). Pure:
// caches, fetch, the digest and the clock are injected, so every rule is
// tested with fakes (src/lib/testing/fakeCaches.ts).

import { normalizeUrl, type Kind } from './classify';

export const HANZI_CACHE = 'qinqin-hanzi-v1';
export const HANZI_CAP = 4000;
/** Set on a response served from a saved copy. */
export const OFFLINE_HEADER = 'X-Qinqin-Offline';
/** ISO time the served copy was saved. */
export const SAVED_AT_HEADER = 'X-Qinqin-Saved-At';

export interface CacheLike {
	match(request: Request | string): Promise<Response | undefined>;
	put(request: Request | string, response: Response): Promise<void>;
	delete(request: Request | string): Promise<boolean>;
	keys(): Promise<readonly Request[]>;
}

export interface CacheStorageLike {
	open(name: string): Promise<CacheLike>;
	delete(name: string): Promise<boolean>;
	keys(): Promise<string[]>;
}

export interface Deps {
	caches: CacheStorageLike;
	fetch: (request: Request, init?: { signal?: AbortSignal }) => Promise<Response>;
	/** The partition name of an Authorization header value. */
	digest: (authorization: string) => Promise<string>;
	now: () => number;
	/** `qinqin-shell-<version>`. */
	shellCache: string;
	origin: string;
	timeouts: { navigate: number; api: number };
}

/** A gateway or availability failure: the server is unreachable in effect. */
const FALLBACK_STATUSES = new Set([502, 503, 504]);

type Outcome = { response: Response } | { timedOut: true; pending: Promise<Response> };

/** firstOf races the network with the timeout; the request itself keeps running on a timeout. */
async function firstOf(net: Promise<Response>, ms: number): Promise<Outcome> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<'timeout'>((resolve) => {
		timer = setTimeout(() => resolve('timeout'), ms);
	});
	try {
		const winner = await Promise.race([net, timeout]);
		return winner === 'timeout' ? { timedOut: true, pending: net } : { response: winner };
	} finally {
		clearTimeout(timer);
	}
}

/**
 * networkFirst answers from the network unless it fails (error, timeout, a
 * gateway status), in which case `saved()` may answer. A timeout with nothing
 * saved keeps waiting for the network instead of failing a slow but working
 * connection. `onResponse` sees every network response first (store, purge).
 */
async function networkFirst(
	req: Request,
	d: Deps,
	ms: number,
	saved: () => Promise<Response | undefined>,
	onResponse: (res: Response) => Promise<void>
): Promise<Response> {
	const controller = new AbortController();
	const net = d.fetch(req, { signal: controller.signal });
	let outcome: Outcome;
	try {
		outcome = await firstOf(net, ms);
	} catch (err) {
		const hit = await saved();
		if (hit) return hit;
		throw err;
	}
	let response: Response;
	if ('timedOut' in outcome) {
		const hit = await saved();
		if (hit) {
			controller.abort();
			outcome.pending.catch(() => undefined);
			return hit;
		}
		response = await outcome.pending;
	} else {
		response = outcome.response;
	}
	await onResponse(response);
	if (FALLBACK_STATUSES.has(response.status)) return (await saved()) ?? response;
	return response;
}

function marked(hit: Response): Response {
	const headers = new Headers(hit.headers);
	headers.set(OFFLINE_HEADER, '1');
	return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
}

async function apiRequest(req: Request, d: Deps): Promise<Response> {
	const authorization = req.headers.get('authorization');
	// classify() never sends such a request here; stay safe if one arrives.
	if (!authorization) return d.fetch(req);
	const name = await d.digest(authorization);
	const key = new URL(normalizeUrl(req.url), d.origin).href;
	const cache = await d.caches.open(name);
	return networkFirst(
		req,
		d,
		d.timeouts.api,
		async () => {
			const hit = await cache.match(key);
			return hit ? marked(hit) : undefined;
		},
		async (res) => {
			if (res.status === 401) {
				// The session is gone: nothing saved for it is reachable any more.
				await d.caches.delete(name);
				return;
			}
			if (res.status !== 200) return;
			// The server asked for this answer not to be kept.
			if (/no-store/i.test(res.headers.get('cache-control') ?? '')) return;
			try {
				const headers = new Headers(res.headers);
				headers.set(SAVED_AT_HEADER, new Date(d.now()).toISOString());
				const copy = res.clone();
				await cache.put(key, new Response(copy.body, { status: 200, statusText: copy.statusText, headers }));
			} catch {
				// Quota or a closed cache: the live response is still returned.
			}
		}
	);
}

async function navigateRequest(req: Request, d: Deps): Promise<Response> {
	const shell = async (): Promise<Response | undefined> => {
		const cache = await d.caches.open(d.shellCache);
		return cache.match(new URL('/', d.origin).href);
	};
	return networkFirst(req, d, d.timeouts.navigate, shell, async () => undefined);
}

async function shellRequest(req: Request, d: Deps): Promise<Response> {
	const cache = await d.caches.open(d.shellCache);
	const hit = await cache.match(new URL(new URL(req.url).pathname, d.origin).href);
	return hit ?? d.fetch(req);
}

async function hanziRequest(req: Request, d: Deps): Promise<Response> {
	const cache = await d.caches.open(HANZI_CACHE);
	const key = new URL(new URL(req.url).pathname, d.origin).href;
	const hit = await cache.match(key);
	if (hit) return hit;
	const res = await d.fetch(req);
	if (res.status === 200) {
		try {
			await cache.put(key, res.clone());
			const keys = await cache.keys();
			for (const old of keys.slice(0, Math.max(0, keys.length - HANZI_CAP))) await cache.delete(old);
		} catch {
			// Not stored; the character is simply fetched again next time.
		}
	}
	return res;
}

/** handleFetch answers one non-bypass request. */
export function handleFetch(kind: Exclude<Kind, 'bypass'>, req: Request, d: Deps): Promise<Response> {
	switch (kind) {
		case 'api':
			return apiRequest(req, d);
		case 'navigate':
			return navigateRequest(req, d);
		case 'shell':
			return shellRequest(req, d);
		case 'hanzi':
			return hanziRequest(req, d);
	}
}
