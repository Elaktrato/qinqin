// The service worker's wiring, with the global scope injected so a fake
// ServiceWorkerGlobalScope can drive it in tests. service-worker.ts (the
// SvelteKit entry) only passes the real scope and the build lists.

import { classify } from './classify';
import { onActivate, onInstall, onMessage, shellCacheName } from './lifecycle';
import { partitionName } from './partition';
import { handleFetch, type CacheStorageLike, type Deps } from './strategies';

export interface SwEv {
	waitUntil(promise: Promise<unknown>): void;
}
export interface FetchEv extends SwEv {
	request: Request;
	respondWith(response: Promise<Response> | Response): void;
}
export interface MessageEv extends SwEv {
	data: unknown;
}

/** The slice of ServiceWorkerGlobalScope the worker uses. */
export interface SwScope {
	addEventListener(type: 'install' | 'activate', listener: (event: SwEv) => void): void;
	addEventListener(type: 'fetch', listener: (event: FetchEv) => void): void;
	addEventListener(type: 'message', listener: (event: MessageEv) => void): void;
	skipWaiting(): Promise<void>;
	clients: { claim(): Promise<void> };
	caches: CacheStorageLike;
	fetch(request: Request, init?: { signal?: AbortSignal }): Promise<Response>;
	location: { origin: string };
}

export interface WorkerConfig {
	version: string;
	/** `$service-worker` build: the app's hashed files. */
	build: readonly string[];
	/** `$service-worker` files: static files, already filtered (no hanzi/, no licence texts). */
	files: readonly string[];
}

export function startWorker(scope: SwScope, config: WorkerConfig): void {
	const origin = scope.location.origin;
	const shellUrls = [...config.build, ...config.files];
	const shellSet = new Set(shellUrls);
	const deps: Deps = {
		caches: scope.caches,
		fetch: (req, init) => scope.fetch(req, init),
		digest: (authorization) => partitionName(authorization),
		now: () => Date.now(),
		shellCache: shellCacheName(config.version),
		origin,
		timeouts: { navigate: 4000, api: 8000 }
	};

	scope.addEventListener('install', (event) => {
		event.waitUntil(onInstall({ caches: scope.caches, fetch: (r) => scope.fetch(r), origin }, config.version, shellUrls));
	});
	scope.addEventListener('activate', (event) => {
		event.waitUntil(onActivate({ caches: scope.caches, claim: () => scope.clients.claim() }, config.version));
	});
	scope.addEventListener('message', (event) => {
		onMessage(event.data, () => void scope.skipWaiting());
	});
	scope.addEventListener('fetch', (event) => {
		const kind = classify(event.request, { origin, shellUrls: shellSet });
		// Not ours: no respondWith, the browser does what it always did.
		if (kind === 'bypass') return;
		event.respondWith(handleFetch(kind, event.request, deps));
	});
}
