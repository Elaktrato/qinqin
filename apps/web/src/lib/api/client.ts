import { goto } from '$app/navigation';
import { normalizePath, redirectsOnUnauthorized } from '../routeAccess';

// The bearer token lives in localStorage under this exact key: the
// static SPA has no server session, so every reload rehydrates from here.
export const TOKEN_KEY = 'qinqin.token';

// ApiError carries the HTTP status alongside the plain-text body the Go
// API sends for 4xx/5xx responses.
export class ApiError extends Error {
	status: number;
	/** Seconds from a Retry-After header, when the server sent one. */
	retryAfterSeconds?: number;

	constructor(status: number, message: string, retryAfterSeconds?: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
	}
}

export interface ApiOptions {
	method?: string;
	body?: unknown;
	/** Attach the stored bearer token. Defaults to true. */
	auth?: boolean;
	/** Aborts the request. */
	signal?: AbortSignal;
}

let unauthorizedHandler: (() => void) | null = null;
let workspaceGoneHandler: (() => void) | null = null;

/** The API's 404 text for a workspace that does not exist (any more). */
export const WORKSPACE_GONE_MESSAGE = 'workspace not found';

/** True for a 404 whose text says the workspace does not exist. */
export function isWorkspaceGoneResponse(status: number, message: string): boolean {
	return status === 404 && message.trim().toLowerCase() === WORKSPACE_GONE_MESSAGE;
}

/**
 * Registers a callback fired when a request comes back 401, so the auth
 * store can drop its in-memory state. The client itself stays free of
 * store imports to avoid an import cycle.
 */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
	unauthorizedHandler = handler;
}

/**
 * Registers a callback fired when a request comes back 404 "workspace not
 * found": the workspace was deleted in another tab or on another device,
 * so the workspace store reloads its list (lib/workspaceGone.ts).
 */
export function setWorkspaceGoneHandler(handler: (() => void) | null): void {
	workspaceGoneHandler = handler;
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
	return normalizePath(window.location.pathname);
}

/**
 * api performs a same-origin JSON request. A stored token is attached as
 * `Authorization: Bearer` unless `auth` is false. Non-2xx responses throw
 * ApiError; a 401 also clears the token and redirects to /login from a
 * private page. On /login or /register that would loop, and on an open page
 * (the Sources page) the user is signed out quietly and stays put
 * (lib/routeAccess.ts).
 */
async function request(path: string, options: ApiOptions): Promise<Response> {
	const headers: Record<string, string> = { accept: 'application/json' };
	const token = getToken();
	if (options.auth !== false && token) {
		headers.authorization = `Bearer ${token}`;
	}

	const hasBody = options.body !== undefined;
	// FormData is passed through untouched: the browser must set the
	// multipart content-type itself, including the boundary.
	const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
	if (hasBody && !isForm) {
		headers['content-type'] = 'application/json';
	}

	const response = await fetch(path, {
		method: options.method ?? (hasBody ? 'POST' : 'GET'),
		headers,
		body: hasBody ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
		signal: options.signal
	});

	if (!response.ok) {
		const message = (await response.text()).trim() || response.statusText || `HTTP ${response.status}`;
		if (response.status === 401) {
			clearToken();
			unauthorizedHandler?.();
			if (redirectsOnUnauthorized(currentPath())) {
				void goto('/login');
			}
		}
		if (isWorkspaceGoneResponse(response.status, message)) workspaceGoneHandler?.();
		const retry = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
		throw new ApiError(response.status, message, Number.isFinite(retry) && retry > 0 ? retry : undefined);
	}
	return response;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
	const response = await request(path, options);
	if (response.status === 204) {
		return undefined as T;
	}

	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * apiBlob is api() for a binary body (a photo): the same bearer token,
 * 401 and workspace-gone handling, but the response comes back as a Blob.
 */
export async function apiBlob(path: string, options: ApiOptions = {}): Promise<Blob> {
	const response = await request(path, options);
	return response.blob();
}

/**
 * apiErrorBody parses the `{error, message}` JSON the AI and journal
 * routes answer with; null for any other error or a plain-text body.
 */
export function apiErrorBody(err: unknown): { error: string; message: string } | null {
	if (!(err instanceof ApiError)) return null;
	try {
		const body = JSON.parse(err.message) as unknown;
		if (typeof body !== 'object' || body === null) return null;
		const { error, message } = body as { error?: unknown; message?: unknown };
		if (typeof error !== 'string') return null;
		return { error, message: typeof message === 'string' ? message : '' };
	} catch {
		return null;
	}
}
