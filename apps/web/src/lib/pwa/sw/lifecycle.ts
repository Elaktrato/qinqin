// Install, activate and message handling of the worker, with injected
// dependencies. A new build is a new worker (its bytes embed `version`): it
// precaches its shell into a cache of its own name and WAITS - it never takes
// over by itself, only when the page asks (the update banner's Reload).

import { API_CACHE_FAMILY, API_CACHE_PREFIX } from './partition';
import type { CacheStorageLike } from './strategies';

export const SHELL_PREFIX = 'qinqin-shell-';

export function shellCacheName(version: string): string {
	return `${SHELL_PREFIX}${version}`;
}

/**
 * onInstall fetches every shell URL (and `/`, the SPA entry the offline
 * navigation falls back to) bypassing the HTTP cache. Any failure rejects, so
 * the browser keeps the old worker; the half-filled cache is removed.
 */
export async function onInstall(
	d: { caches: CacheStorageLike; fetch: (request: Request) => Promise<Response>; origin: string },
	version: string,
	urls: readonly string[]
): Promise<void> {
	const name = shellCacheName(version);
	await d.caches.delete(name);
	const cache = await d.caches.open(name);
	const all = [...new Set(['/', ...urls])];
	try {
		await Promise.all(
			all.map(async (path) => {
				const url = new URL(path, d.origin).href;
				const res = await d.fetch(new Request(url, { cache: 'reload' }));
				if (!res.ok) throw new Error(`precache ${path}: HTTP ${res.status}`);
				await cache.put(url, res);
			})
		);
	} catch (err) {
		await d.caches.delete(name);
		throw err;
	}
}

/**
 * onActivate removes what this version no longer needs: other shells and API
 * partitions of an older generation. The current shell, the current API
 * partitions (other generations are not ours to judge: keep newer) and the
 * stroke cache stay. Then it takes control of open pages.
 */
export async function onActivate(
	d: { caches: CacheStorageLike; claim: () => Promise<void> },
	version: string
): Promise<void> {
	const current = shellCacheName(version);
	for (const name of await d.caches.keys()) {
		const oldShell = name.startsWith(SHELL_PREFIX) && name !== current;
		const oldApi =
			name.startsWith(API_CACHE_FAMILY) &&
			!name.startsWith(API_CACHE_PREFIX) &&
			generation(name) < generation(API_CACHE_PREFIX);
		if (oldShell || oldApi) await d.caches.delete(name);
	}
	await d.claim();
}

function generation(name: string): number {
	const n = Number.parseInt(name.slice(API_CACHE_FAMILY.length), 10);
	return Number.isFinite(n) ? n : 0;
}

/** onMessage: the only way a waiting worker takes over is the page asking. */
export function onMessage(data: unknown, skipWaiting: () => void): void {
	if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'skip-waiting') {
		skipWaiting();
	}
}
