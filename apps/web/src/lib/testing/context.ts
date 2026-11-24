// Test contexts (record 0009): a fresh app context and session built from
// fakes for every test, instead of resetting module state. A component test
// renders with `{ props: props, context: ctx.context }`; a module test passes `ctx.session` (or the
// part it needs) to the code under test.
//
//   const ctx = testContext({ user: { id: 1 } });
//   render(Page, { props: { id: 7 }, context: ctx.context });

import { vi } from 'vitest';
import { ApiError, api as moduleApi, type ApiOptions } from '../api/client';
import type { User } from '../auth.svelte';
import { createAppContext, type AppContext } from '../context/app.svelte';
import { contextOf } from '../context/context';
import { webStorage, type Api, type AppDeps, type EventSource, type Timers, type VisibilitySource } from '../context/deps';
import type { Session } from '../context/session.svelte';
import type { Workspaces, WorkspacesState } from '../workspaces.svelte';

/** An answer for `METHOD /path` (the query string included when the route names one). */
export type Route = (body: unknown, path: string, options: ApiOptions) => unknown;

/** memoryStorage: a Web Storage area in memory. */
export function memoryStorage(): Storage {
	const data = new Map<string, string>();
	return {
		getItem: (key: string) => data.get(String(key)) ?? null,
		setItem: (key: string, value: string) => void data.set(String(key), String(value)),
		removeItem: (key: string) => void data.delete(String(key)),
		clear: () => data.clear(),
		key: (index: number) => [...data.keys()][index] ?? null,
		get length() {
			return data.size;
		}
	} as Storage;
}

/**
 * fakeApi answers from `routes` (keys `GET /api/x`, `POST /api/x`; a route
 * without a query string also answers its path with one); anything else is a
 * 404. A route may throw. Every call is recorded (`vi.fn`).
 */
export function fakeApi(routes: Record<string, Route | unknown> = {}): Api & ReturnType<typeof vi.fn> {
	const fn = vi.fn(async (path: string, options: ApiOptions = {}) => {
		const method = options.method ?? (options.body === undefined ? 'GET' : 'POST');
		const bare = path.split('?')[0];
		const key = [`${method} ${path}`, `${method} ${bare}`].find((k) => k in routes);
		if (key === undefined) throw new ApiError(404, JSON.stringify({ error: 'not_found', message: `no fake route ${method} ${path}` }));
		const route = routes[key];
		return typeof route === 'function' ? (route as Route)(options.body, path, options) : route;
	});
	return fn as unknown as Api & ReturnType<typeof vi.fn>;
}

/** manualTimers: timers that run only when the test advances them. */
export interface ManualTimers extends Timers {
	/** Runs every timer due within `ms` from now, in order. */
	advance(ms: number): void;
	/** How many timers are pending. */
	pending(): number;
}

export function manualTimers(): ManualTimers {
	let now = 0;
	let seq = 0;
	const due = new Map<number, { at: number; fn: () => void; every: number | null }>();
	return {
		set: (fn, ms) => {
			const id = ++seq;
			due.set(id, { at: now + ms, fn, every: null });
			return id;
		},
		clear: (handle) => void due.delete(handle as number),
		every: (fn, ms) => {
			const id = ++seq;
			due.set(id, { at: now + ms, fn, every: ms });
			return id;
		},
		stop: (handle) => void due.delete(handle as number),
		advance(ms) {
			const end = now + ms;
			for (;;) {
				const next = [...due.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
				if (next === undefined) break;
				const [id, timer] = next;
				now = timer.at;
				if (timer.every === null) due.delete(id);
				else timer.at += timer.every;
				timer.fn();
			}
			now = end;
		},
		pending: () => due.size
	};
}

/** A window stand-in that the test can dispatch events on. */
export function fakeWindow(): EventSource & { dispatch(event: Event): void } {
	const target = new EventTarget();
	return {
		addEventListener: (type, listener) => target.addEventListener(type, listener),
		removeEventListener: (type, listener) => target.removeEventListener(type, listener),
		dispatch: (event) => void target.dispatchEvent(event)
	};
}

/** A document stand-in whose visibility the test sets. */
export function fakeDocument(): VisibilitySource & { dispatch(event: Event): void; visibilityState: string } {
	const target = new EventTarget();
	return {
		visibilityState: 'visible',
		addEventListener: (type, listener) => target.addEventListener(type, listener),
		removeEventListener: (type, listener) => target.removeEventListener(type, listener),
		dispatch: (event) => void target.dispatchEvent(event)
	};
}

/**
 * fakeDeps: app dependencies from fakes; `routes` answers the API. Without
 * routes the API is the module's `api` (a test that mocks lib/api/client or
 * stubs fetch answers it), so the state objects and the API helpers share it.
 * Storage is the environment's (jsdom's, or a test's stub, read at each call)
 * and an in-memory area where there is none.
 */
export function fakeDeps(routes?: Record<string, Route | unknown>, overrides: Partial<AppDeps> = {}): AppDeps {
	const local = memoryStorage();
	const session = memoryStorage();
	return {
		api: routes === undefined ? moduleApi : fakeApi(routes),
		local: () => webStorage('localStorage') ?? local,
		session: () => webStorage('sessionStorage') ?? session,
		now: () => Date.now(),
		timers: manualTimers(),
		window: fakeWindow(),
		document: fakeDocument(),
		...overrides
	};
}

export interface TestContextOptions {
	/** The signed-in user (merged over defaults); null: signed out. Default: user 1. */
	user?: Partial<User> | null;
	token?: string;
	/** API answers (fakeApi), or a ready `api`. */
	routes?: Record<string, Route | unknown>;
	deps?: Partial<AppDeps>;
}

export interface TestContext {
	app: AppContext;
	/** The signed-in session (throws when the context is signed out). */
	readonly session: Session;
	deps: AppDeps;
	/** The context map a component renders with: `render(C, { props, context: ctx.context })`. */
	context: Map<unknown, unknown>;
}

/** workspacesState: the plain `{ list, current }` of a Workspaces (for toEqual). */
export function workspacesState(workspaces: Workspaces): WorkspacesState {
	return { list: workspaces.list, current: workspaces.current };
}

/** updateWorkspaces: replaces the list and selection with `fn` of the current ones. */
export function updateWorkspaces(workspaces: Workspaces, fn: (state: WorkspacesState) => WorkspacesState): void {
	workspaces.set(fn(workspacesState(workspaces)));
}

export function testUser(over: Partial<User> = {}): User {
	return {
		id: 1,
		username: 'ada',
		admin: false,
		email: null,
		emailVerified: false,
		mustChangePassword: false,
		createdAt: '2026-01-01T00:00:00Z',
		...over
	};
}

/** testContext: a fresh app context, signed in as `user` (default user 1) unless `user: null`. */
export function testContext(options: TestContextOptions = {}): TestContext {
	const deps = fakeDeps(options.routes, options.deps ?? {});
	const app = createAppContext(deps);
	if (options.user !== null) app.auth.set({ token: options.token ?? 'test-token', user: testUser(options.user ?? {}) });
	const context = contextOf(app);
	return {
		app,
		deps,
		get session(): Session {
			const session = app.session;
			if (session === null) throw new Error('testContext: signed out');
			return session;
		},
		context
	};
}
