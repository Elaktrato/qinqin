import { goto } from '$app/navigation';

// The bearer token lives in localStorage under this exact key: the
// static SPA has no server session, so every reload rehydrates from here.
export const TOKEN_KEY = 'qinqin.token';

// ApiError carries the HTTP status alongside the plain-text body the Go
// API sends for 4xx/5xx responses.
export class ApiError extends Error {
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

export interface ApiOptions {
	method?: string;
	body?: unknown;
	/** Attach the stored bearer token. Defaults to true. */
	auth?: boolean;
}

let unauthorizedHandler: (() => void) | null = null;

/**
 * Registers a callback fired when a request comes back 401, so the auth
 * store can drop its in-memory state. The client itself stays free of
 * store imports to avoid an import cycle.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
	unauthorizedHandler = handler;
}

export function getToken(): string | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function setToken(token: string): void {
	try {
		localStorage.setItem(TOKEN_KEY, token);
	} catch {
		// Storage unavailable (private mode): the in-memory store still works.
	}
}

export function clearToken(): void {
	try {
		localStorage.removeItem(TOKEN_KEY);
	} catch {
		// Nothing to clear.
	}
}

function currentPath(): string {
	if (typeof window === 'undefined') return '';
	return window.location.pathname.replace(/\/+$/, '') || '/';
}

/** True when the browser is on a page where a 401 must not redirect. */
export function isAuthRoute(path = currentPath()): boolean {
	return path === '/login' || path === '/register';
}

/**
 * api performs a same-origin JSON request. A stored token is attached as
 * `Authorization: Bearer` unless `auth` is false. Non-2xx responses throw
 * ApiError; a 401 also clears the token and redirects to /login unless the
 * current page is /login or /register (which would loop).
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
	const headers: Record<string, string> = { accept: 'application/json' };
	const token = getToken();
	if (options.auth !== false && token) {
		headers.authorization = `Bearer ${token}`;
	}

	const hasBody = options.body !== undefined;
	if (hasBody) {
		headers['content-type'] = 'application/json';
	}

	const response = await fetch(path, {
		method: options.method ?? (hasBody ? 'POST' : 'GET'),
		headers,
		body: hasBody ? JSON.stringify(options.body) : undefined
	});

	if (!response.ok) {
		const message = (await response.text()).trim() || response.statusText || `HTTP ${response.status}`;
		if (response.status === 401) {
			clearToken();
			unauthorizedHandler?.();
			if (!isAuthRoute()) {
				void goto('/login');
			}
		}
		throw new ApiError(response.status, message);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}
