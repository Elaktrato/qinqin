import { clearAudioCache } from './api/audio';
import { clearClipCache } from './audio/source';
import { derived, writable } from 'svelte/store';
import { clearSelection } from './workspaces';
import {
	api,
	clearToken,
	getToken,
	setRestrictedHandler,
	setToken,
	setUnauthorizedHandler
} from './api/client';

/** Why a session may not use the whole app yet; null for a full session. */
export type Restriction = 'password_change' | 'mfa_enrollment';

export interface User {
	id: number;
	username: string;
	admin: boolean;
	email: string | null;
	emailVerified: boolean;
	mustChangePassword: boolean;
	createdAt: string;
	/** Only `GET /api/auth/me` sends it: "" or a Restriction. */
	restriction?: '' | Restriction;
}

export interface AuthState {
	token: string | null;
	user: User | null;
}

// The single source of truth for the session: the bearer token plus the
// user it belongs to. Pages subscribe with `$auth` / `$user`.
export const auth = writable<AuthState>({ token: null, user: null });

export const token = derived(auth, ($auth) => $auth.token);
export const user = derived(auth, ($auth) => $auth.user);
/** The restriction of the current session (from `me`), or null. */
export const restriction = derived(auth, ($auth): Restriction | null => $auth.user?.restriction || null);

// A 401 anywhere clears the token in the client; mirror that in the store.
setUnauthorizedHandler(() => auth.set({ token: null, user: null }));

// A 403 that names a restriction means the session changed under us (an admin
// forced a password change): reload `me` so the layout guard moves it.
setRestrictedHandler(() => {
	void loadMe().catch(() => undefined);
});

/**
 * loadMe hydrates the user for the stored token (or `known`, a token the
 * caller just received). With no token it stays signed out without
 * calling the API.
 */
export async function loadMe(known?: string): Promise<User | null> {
	// A token the caller just received wins over storage, which may be blocked.
	const stored = known ?? getToken();
	if (!stored) {
		auth.set({ token: null, user: null });
		return null;
	}

	// Boot: hydrate the token before the round-trip so a transient network
	// failure does not bounce a signed-in user back to /login. A token the
	// caller just received (login) is not announced until /me has answered,
	// so a failing /me cannot flip the guard away from the page that shows
	// the error.
	if (known === undefined) auth.set({ token: stored, user: null });

	const me = await api<User>('/api/auth/me');
	auth.set({ token: stored, user: me });
	return me;
}

/**
 * login exchanges credentials for a bearer token, persists it under
 * `qinqin.token`, and loads the user it belongs to. Status
 * `password_change_required` is a signed-in session too: the token is kept
 * and `me` reports the restriction, so the layout guard sends the user to
 * the forced change page.
 */
export async function login(username: string, password: string): Promise<User> {
	const response = await api<{ status: string; token: string }>('/api/auth/login', {
		method: 'POST',
		body: { username, password }
	});

	setToken(response.token);

	// A token without a user is no session: when /me fails, forget the token
	// (a 401 already did) so the sign-in page can show the error.
	try {
		const me = await loadMe(response.token);
		if (!me) throw new Error('login did not return a user');
		return me;
	} catch (err) {
		clearToken();
		auth.set({ token: null, user: null });
		throw err;
	}
}

/**
 * register creates the account and signs it in. The first account on a
 * fresh instance becomes admin; afterwards the API requires an admin
 * token, so callers on the register page are unauthenticated.
 */
export async function register(username: string, password: string): Promise<User> {
	const created = await api<User>('/api/auth/register', {
		method: 'POST',
		body: { username, password }
	});

	await login(username, password);
	return created;
}

/**
 * logout ends the session on the server (best effort), then forgets the
 * token and the in-memory user. The layout guard
 * notices the signed-out session and leaves any protected page, so there
 * is no navigation here to fail or double up.
 */
export function logout(): void {
	// Best effort: the server drops the session row, but signing out never
	// waits for it or fails because of it. The request carries the token, so
	// it is sent before the token is cleared.
	if (getToken() !== null) {
		api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
	}
	clearToken();
	// Recordings fetched for this user must not outlive the session.
	clearClipCache();
	clearAudioCache();
	// Workspace ids are global: the next user must not inherit this choice.
	// Only an explicit sign-out clears it; a mid-session 401 keeps it.
	clearSelection();
	auth.set({ token: null, user: null });
}
