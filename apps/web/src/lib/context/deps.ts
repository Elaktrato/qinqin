// What the app's state objects are built from (record 0009): the API client,
// the two Web Storage areas, the clock, timers and the window to listen on.
// Every state class takes the part it needs in its constructor and reaches no
// browser global by itself; browserDeps() is the production set, the test
// helper (lib/testing/context.ts) builds one from fakes.

import { api } from '../api/client';
import { browserRegistrationEnv, type RegistrationEnv } from '../pwa/register.svelte';

export type Api = typeof api;

export interface Timers {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
	every(fn: () => void, ms: number): unknown;
	stop(handle: unknown): void;
}

/** The slice of `window` the state objects listen on. */
export interface EventSource {
	addEventListener(type: string, listener: (event: Event) => void): void;
	removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** The slice of `document` the state objects follow (visibility). */
export interface VisibilitySource extends EventSource {
	readonly visibilityState: string;
}

export interface AppDeps {
	api: Api;
	/** localStorage, or null where it is missing or access throws (blocked site data). */
	local(): Storage | null;
	/** sessionStorage, the same way. */
	session(): Storage | null;
	now(): number;
	timers: Timers;
	/** The window, for storage and online events; null outside a browser. */
	window: EventSource | null;
	/** The document, for visibility; null outside a browser. */
	document: VisibilitySource | null;
	/** The IndexedDB factory (the durable review outbox); null or absent: the outbox uses localStorage. */
	indexedDB?: IDBFactory | null;
	/** Whether the browser says it is online (navigator.onLine). */
	online(): boolean;
	/** The service worker container; null: no worker (tests, outside a browser). */
	worker: RegistrationEnv | null;
}

/** webStorage: a Web Storage area, or null where it is missing or access throws. */
export function webStorage(name: 'localStorage' | 'sessionStorage'): Storage | null {
	try {
		return typeof globalThis[name] === 'undefined' ? null : globalThis[name];
	} catch {
		return null;
	}
}

/** webIndexedDB: the browser's IndexedDB, or null where it is missing or access throws. */
export function webIndexedDB(): IDBFactory | null {
	try {
		return typeof indexedDB === 'undefined' ? null : indexedDB;
	} catch {
		return null;
	}
}

export const browserTimers: Timers = {
	set: (fn, ms) => setTimeout(fn, ms),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
	every: (fn, ms) => setInterval(fn, ms),
	stop: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
};

/** browserDeps: the production dependencies (the root layout's app context). */
export function browserDeps(): AppDeps {
	return {
		api,
		local: () => webStorage('localStorage'),
		session: () => webStorage('sessionStorage'),
		now: () => Date.now(),
		timers: browserTimers,
		window: typeof window === 'undefined' ? null : window,
		document: typeof document === 'undefined' ? null : document,
		indexedDB: webIndexedDB(),
		online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
		worker: browserRegistrationEnv()
	};
}
