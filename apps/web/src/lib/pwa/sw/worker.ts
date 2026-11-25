// The service worker's wiring, with the global scope injected so a fake
// ServiceWorkerGlobalScope can drive it in tests. service-worker.ts (the
// SvelteKit entry) only passes the real scope and the build lists.

import { classify } from './classify';
import { onActivate, onInstall, onMessage, shellCacheName } from './lifecycle';
import { partitionName } from './partition';
import { onNotificationClick, onPush, type ClickEv, type ClientLike, type PushEv } from './push';
import { readPushTexts } from './pushTexts';
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
	addEventListener(type: 'push', listener: (event: PushEv) => void): void;
	addEventListener(type: 'notificationclick', listener: (event: ClickEv) => void): void;
	skipWaiting(): Promise<void>;
	clients: {
		claim(): Promise<void>;
		matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly ClientLike[]>;
		openWindow(url: string): Promise<unknown>;
	};
	registration: {
		showNotification(title: string, options: { body: string; tag: string; icon: string; data: { route: string } }): Promise<void>;
	};
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
	// Push (#139): the payload is text-free; the notification text is the page's stored map (pushTexts.ts).
	// Nothing here is cached, and no fetch is involved.
	scope.addEventListener('push', (event) => {
		onPush(event, {
			show: (title, options) => scope.registration.showNotification(title, options),
			texts: () => readPushTexts(scope.caches)
		});
	});
	scope.addEventListener('notificationclick', (event) => {
		onNotificationClick(event, { clients: scope.clients, origin });
	});
}
