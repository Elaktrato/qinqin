
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
	/** Lets the request outlive the page (a save on pagehide). Bodies over 64 KiB cannot use it. */
	keepalive?: boolean;
}

let unauthorizedHandler: (() => void) | null = null;
let workspaceGoneHandler: (() => void) | null = null;
let restrictedHandler: (() => void) | null = null;

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

/** True for the 403 body of a restricted session (`password_change_required`, `mfa_enrollment_required`). */
export function isRestrictionResponse(status: number, message: string): boolean {
	if (status !== 403) return false;
	try {
		const code = (JSON.parse(message) as { error?: unknown }).error;
		return typeof code === 'string' && RESTRICTION_CODES.has(code);
	} catch {
		return false;
	}
}

/**
 * Registers a callback fired when a request is refused with 403
 * `password_change_required` or `mfa_enrollment_required`: the session is
 * restricted, so the auth store reloads `me` and the layout guard moves it
 * to the page it may use. The token stays; this is not a 401.
 */
export function setRestrictedHandler(handler: (() => void) | null): void {
	restrictedHandler = handler;
}

const RESTRICTION_CODES: ReadonlySet<string> = new Set([
	'password_change_required',
	'mfa_enrollment_required'
]);

/**
 * Registers a callback fired when a request comes back 404 "workspace not
 * found": the workspace was deleted in another tab or on another device,
 * so the workspace store reloads its list (lib/workspaceGone.ts).
 */
export function setWorkspaceGoneHandler(handler: (() => void) | null): void {
	workspaceGoneHandler = handler;
}

// Only used when storage refuses the write (blocked or private mode): the
// session then lasts until the tab is closed instead of failing at once.
let memoryToken: string | null = null;

export function getToken(): string | null {
	try {
		// A token held in memory (storage refused it) is newer than anything stored.
		if (memoryToken !== null) return memoryToken;
		return typeof localStorage === 'undefined' ? null : localStorage.getItem(TOKEN_KEY);
	} catch {
		return memoryToken;
	}
}

export function setToken(token: string): void {
	try {
		localStorage.setItem(TOKEN_KEY, token);
		memoryToken = null;
	} catch {
		memoryToken = token;
		// Do not leave an older stored token behind to be sent or reloaded.
		try {
			localStorage.removeItem(TOKEN_KEY);
		} catch {
			// Storage is unusable; memory holds the session.
		}
	}
}

export function clearToken(): void {
	memoryToken = null;
	try {
		localStorage.removeItem(TOKEN_KEY);
	} catch {
		// Nothing to clear.
	}
}

// The bearer token goes only to this app's own API: a same-origin absolute
// path. An absolute URL or a protocol-relative `//host/...` would send the
// token to another origin.
export function isOwnApiPath(path: string): boolean {
	return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\');
}

/**
 * notifyUnauthorized is what any 401 does: drop the token and tell the auth
 * store. It never navigates: the layout guard (lib/routeAccess.ts) is the
 * single owner of the redirect to /login. api() and the XHR upload helper
 * share it, so a session that drops mid-upload logs out too.
 */
export function notifyUnauthorized(): void {
	clearToken();
	unauthorizedHandler?.();
}

/**
 * api performs a same-origin JSON request. A stored token is attached as
 * `Authorization: Bearer` unless `auth` is false. Non-2xx responses throw
 * ApiError; a 401 also clears the token and tells the auth store, and the
 * layout guard (lib/routeAccess.ts) is the one place that navigates to
 * /login — on an auth or open page the user simply stays put.
 */
async function request(path: string, options: ApiOptions): Promise<Response> {
	const headers: Record<string, string> = { accept: 'application/json' };
	const token = getToken();
	if (options.auth !== false && token && isOwnApiPath(path)) {
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
		signal: options.signal,
		...(options.keepalive ? { keepalive: true } : {})
	});

	if (!response.ok) {
		const message = (await response.text()).trim() || response.statusText || `HTTP ${response.status}`;
		if (response.status === 401) notifyUnauthorized();
		if (isWorkspaceGoneResponse(response.status, message)) workspaceGoneHandler?.();
		if (response.status === 403 && restrictedHandler) {
			try {
				const code = (JSON.parse(message) as { error?: unknown }).error;
				if (typeof code === 'string' && RESTRICTION_CODES.has(code)) restrictedHandler();
			} catch {
				// Not a JSON body: an ordinary 403.
			}
		}
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
export function apiErrorBody(err: unknown): { error: string; message: string; attemptsLeft?: number } | null {
	if (!(err instanceof ApiError)) return null;
	try {
		const body = JSON.parse(err.message) as unknown;
		if (typeof body !== 'object' || body === null) return null;
		const { error, message, attemptsLeft } = body as { error?: unknown; message?: unknown; attemptsLeft?: unknown };
		if (typeof error !== 'string') return null;
		const out: { error: string; message: string; attemptsLeft?: number } = { error, message: typeof message === 'string' ? message : '' };
		if (typeof attemptsLeft === 'number') out.attemptsLeft = attemptsLeft;
		return out;
	} catch {
		return null;
	}
}
