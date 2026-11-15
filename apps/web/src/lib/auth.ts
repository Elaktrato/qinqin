import { derived, writable } from 'svelte/store';
import { clearSelection } from './workspaces';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from './api/client';

export interface User {
	id: number;
	username: string;
	admin: boolean;
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

// A 401 anywhere clears the token in the client; mirror that in the store.
setUnauthorizedHandler(() => auth.set({ token: null, user: null }));

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
 * `qinqin.token`, and loads the user it belongs to.
 */
export async function login(username: string, password: string): Promise<User> {
	const response = await api<{ token: string }>('/api/auth/login', {
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
 * logout forgets the token and the in-memory user. The layout guard
 * notices the signed-out session and leaves any protected page, so there
 * is no navigation here to fail or double up.
 */
export function logout(): void {
	clearToken();
	// Workspace ids are global: the next user must not inherit this choice.
	// Only an explicit sign-out clears it; a mid-session 401 keeps it.
	clearSelection();
	auth.set({ token: null, user: null });
}
