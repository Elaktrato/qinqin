
// The bearer token lives in localStorage under this exact key: the
// static SPA has no server session, so every reload rehydrates from here.
import { reportNetworkFailure, reportResponse } from '../pwa/offlineState';

export const TOKEN_KEY = 'qinqin.token';

// ApiError carries the HTTP status of a 4xx/5xx answer and its body, parsed once here: every API error is
// `{error, message}` (docs/contracts/auth/errors.json). `code` is the `error` string, `body` the parsed object;
// both are undefined for a body that is not one (a proxy's HTML page, an old server's text). `message` keeps the
// raw text for logs and the console only: screens show `errorText(err, fallback)` (lib/api/apiErrors.ts).
export class ApiError extends Error {
	status: number;
	/** The catalogue code of a `{error, message}` body. */
	code?: string;
	/** The parsed `{error, message, ...}` body (with members such as attemptsLeft or existingId). */
	body?: Readonly<Record<string, unknown>>;
	/** Seconds from a Retry-After header, when the server sent one. */
	retryAfterSeconds?: number;

	constructor(status: number, message: string, retryAfterSeconds?: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		const body = parseErrorBody(message);
		if (body !== undefined) {
			this.body = body;
			this.code = body.error as string;
		}
		if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
	}
}

function parseErrorBody(text: string): Record<string, unknown> | undefined {
	if (!text.trimStart().startsWith('{')) return undefined;
	try {
		const body = JSON.parse(text) as unknown;
		if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
		return typeof (body as { error?: unknown }).error === 'string' ? (body as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
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

/** The API's 404 code for a workspace that does not exist (any more). */
export const WORKSPACE_GONE_CODE = 'workspace_not_found';

/** True for the 404 `workspace_not_found` (`code` is ApiError.code). */
export function isWorkspaceGoneResponse(status: number, code: string | undefined): boolean {
	return status === 404 && code === WORKSPACE_GONE_CODE;
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
export function isRestrictionResponse(status: number, code: string | undefined): boolean {
	return status === 403 && code !== undefined && RESTRICTION_CODES.has(code);
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
 * Registers a callback fired when a request comes back 404
 * `workspace_not_found`: the workspace was deleted in another tab or on another device,
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

	let response: Response;
	try {
		response = await fetch(path, {
			method: options.method ?? (hasBody ? 'POST' : 'GET'),
			headers,
			body: hasBody ? (isForm ? (options.body as FormData) : JSON.stringify(options.body)) : undefined,
			signal: options.signal,
			...(options.keepalive ? { keepalive: true } : {})
		});
	} catch (err) {
		// An abort is the caller's choice, not a lost connection.
		if (!(err instanceof DOMException && err.name === 'AbortError')) reportNetworkFailure();
		throw err;
	}
	// The worker marks answers it served from its saved copy (offlineState.ts).
	reportResponse(response.headers);

	if (!response.ok) {
		const text = (await response.text()).trim() || response.statusText || `HTTP ${response.status}`;
		const retry = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
		const err = new ApiError(response.status, text, Number.isFinite(retry) && retry > 0 ? retry : undefined);
		notifyErrorAnswer(err);
		throw err;
	}
	return response;
}

/**
 * notifyErrorAnswer is what every error answer of the API does, fetched or uploaded by XHR: a 401 drops the token,
 * a 404 workspace_not_found tells the workspace store, a restriction code tells the auth store.
 */
export function notifyErrorAnswer(err: ApiError): void {
	if (err.status === 401) notifyUnauthorized();
	if (isWorkspaceGoneResponse(err.status, err.code)) workspaceGoneHandler?.();
	if (isRestrictionResponse(err.status, err.code)) restrictedHandler?.();
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

/** What a screen may read of an API error: its code and the attempts left of a one-time code. */
export interface ApiErrorInfo {
	error: string;
	attemptsLeft?: number;
}

/**
 * apiErrorBody is the code (and attemptsLeft) of an ApiError's `{error, message}` body; null for any other error
 * or a body that is not one. The English `message` is not handed out: screens show the code's text (#168).
 */
export function apiErrorBody(err: unknown): ApiErrorInfo | null {
	if (!(err instanceof ApiError) || err.body === undefined || err.code === undefined) return null;
	const out: ApiErrorInfo = { error: err.code };
	if (typeof err.body.attemptsLeft === 'number') out.attemptsLeft = err.body.attemptsLeft;
	return out;
}
