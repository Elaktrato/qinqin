import { clearAudioCache } from './api/audio';
import { clearClipCache } from './audio/source';
import { derived, writable } from 'svelte/store';
import { clearSelection } from './workspaces';
import { hasSession, stepFor, type LoginStep, type MfaChallenge } from './account/loginFlow';
import { emailLoginVerify, mfaStep, type LoginBody } from './api/mfa';
import { clearStudyDay } from './time/zone';
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
	/** Only `me`: whether the change-password form must ask for the current password. */
	needsCurrentPassword?: boolean;
	/** Only `me`: which second factors the account has. */
	mfa?: { totp: boolean; email: boolean; recoveryCodesLeft: number };
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

/** What a sign-in attempt came to: a session, or a second step to answer first. */
export type SignInResult =
	| { kind: 'session'; user: User; step: LoginStep }
	| { kind: 'mfa'; mfa: MfaChallenge };

/** Turns a login-shaped answer into a stored session or a second step. */
async function settle(response: LoginBody): Promise<SignInResult> {
	const step = stepFor(response.status, response);
	// A status this client does not know must not store a session.
	if (step.kind === 'mfa') return { kind: 'mfa', mfa: step.mfa };
	if (!hasSession(step) || !response.token) throw new Error('This sign-in step is not supported by this app version.');
	return { kind: 'session', user: await signInWithToken(response.token), step };
}

/**
 * signIn exchanges credentials for a bearer token (stored under
 * `qinqin.token`) and loads its user, or, for a user with a second factor,
 * returns the challenge to answer: no token exists before that step. Status
 * `password_change_required` and `mfa_enrollment_required` are signed-in
 * sessions too: `me` reports the restriction and the layout guard sends the
 * user to the page they may use.
 */
export async function signIn(username: string, password: string): Promise<SignInResult> {
	return settle(await api<LoginBody>('/api/auth/login', { method: 'POST', body: { username, password } }));
}

/** completeMfa answers the second step; the result may itself be a session only. */
export async function completeMfa(challenge: string, method: string, code: string): Promise<SignInResult> {
	return settle(await mfaStep(challenge, method, code));
}

/** completeEmailLogin answers an emailed sign-in code (may lead to a second step). */
export async function completeEmailLogin(challenge: string, code: string): Promise<SignInResult> {
	return settle(await emailLoginVerify(challenge, code));
}

/**
 * login is signIn for callers that cannot show a second step (the first
 * sign-in right after registering): a challenge is an error there.
 */
export async function login(username: string, password: string): Promise<User> {
	const result = await signIn(username, password);
	if (result.kind === 'mfa') throw new Error('This account needs a second step: use the sign-in page.');
	return result.user;
}

/**
 * signInWithToken stores a token the server just issued (login, reset link)
 * and loads its user. A token without a user is no session: when /me fails
 * the token is forgotten so the page can show the error.
 */
export async function signInWithToken(token: string): Promise<User> {
	setToken(token);

	// A token without a user is no session: when /me fails, forget the token
	// (a 401 already did) so the sign-in page can show the error.
	try {
		const me = await loadMe(token);
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
export async function register(
	username: string,
	password: string,
	extra: { email?: string; invite?: string } = {}
): Promise<User> {
	const body: Record<string, string> = { username, password };
	if (extra.email) body.email = extra.email;
	if (extra.invite) body.invite = extra.invite;
	const created = await api<User>('/api/auth/register', { method: 'POST', body });

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
	// The learner's zone history belongs to the account that just left.
	clearStudyDay();
	auth.set({ token: null, user: null });
}
