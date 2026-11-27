// The tab's auth state (record 0009): the bearer token and the user it belongs
// to, a runes class owned by the app context (lib/context/app.svelte.ts). The
// app context follows it: a session exists while a token does and ends when it
// goes, or when another user signs in under this tab.

import { UserError } from '$lib/api/userError';
import { resolveInterfaceLanguage, writeMirror } from '$lib/i18n/interfaceLanguage';
import { hasSession, stepFor, type LoginStep, type MfaChallenge } from '$lib/account/loginFlow';
import { emailLoginVerify, mfaStep, type LoginBody } from '$lib/api/mfa';
import { cleanupPartitions, ownPartition } from '$lib/pwa/partitions';
import { clearReceipts } from '$lib/pwa/prepareOffline';
import { browserPushEnv, forgetThisDevice } from '$lib/pwa/push';
import { TOKEN_KEY, clearToken, getToken, setToken } from '$lib/api/client';
import type { AppDeps } from '$lib/context/deps';
import type { SessionEndReason } from '$lib/context/session.svelte';

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
	/** Only `me`: the interface language setting ('' = follow the browser; absent on older servers). */
	interfaceLanguage?: string;
	/** Only `me`: the profile picture's path, or null (docs/contracts/auth/avatar.json). */
	avatarUrl?: string | null;
}

export interface AuthState {
	token: string | null;
	user: User | null;
}

/** What a sign-in attempt came to: a session, or a second step to answer first. */
export type SignInResult =
	| { kind: 'session'; user: User; step: LoginStep }
	| { kind: 'mfa'; mfa: MfaChallenge };

export type AuthDeps = Pick<AppDeps, 'api' | 'local' | 'session' | 'window'>;

/** Called with every new state; `reason` names why a session ends when it does. */
export type AuthListener = (state: AuthState, reason: SessionEndReason | undefined) => void;

const SIGNED_OUT: AuthState = { token: null, user: null };

export class Auth {
	readonly #deps: AuthDeps;
	readonly #listener: AuthListener;
	#state = $state.raw<AuthState>(SIGNED_OUT);

	constructor(deps: AuthDeps, listener: AuthListener) {
		this.#deps = deps;
		this.#listener = listener;
	}

	get state(): AuthState {
		return this.#state;
	}

	get token(): string | null {
		return this.#state.token;
	}

	get user(): User | null {
		return this.#state.user;
	}

	/** The restriction of the current session (from `me`), or null. */
	get restriction(): Restriction | null {
		return this.#state.user?.restriction || null;
	}

	/**
	 * set replaces the state as `me` (or a sign-out) left it; the app context
	 * follows. A user other than the session's ends it (`switched`).
	 */
	set(next: AuthState, reason?: SessionEndReason): void {
		this.#state = next;
		this.#listener(next, reason);
	}

	/** expire: a 401 ended the session (the client already dropped the token). */
	expire(): void {
		// The session ended without a sign-out: on a shared browser the old account's pushes must not go on. The
		// server DELETE needs the token that is gone (best effort: it may answer 401), but the browser's own
		// subscription is dropped and the remembered id forgotten, so the server's row is pruned at its next push.
		forgetThisDevice({ api: this.#deps.api, env: browserPushEnv(), user: this.user?.id ?? null });
		this.set(SIGNED_OUT, 'expired');
		this.#forgetOfflineCopies();
	}

	/**
	 * restricted: a 403 named a restriction, so the session changed under us
	 * (an admin forced a password change): reload `me` so the layout guard moves
	 * it. Already known to be restricted: nothing to learn. The current token is
	 * passed as `known`, so the user is not blanked while `me` is in flight.
	 */
	restricted(): void {
		const current = this.#state.token;
		if (current === null || this.restriction !== null) return;
		void this.loadMe(current).catch(() => undefined);
	}

	/**
	 * followTabs: another tab signed in, out or as someone else. localStorage
	 * holds the one token, so this tab follows at once (a stale tab would
	 * otherwise act, and send queued reviews, as the user it last knew).
	 * Returns the unsubscribe.
	 */
	followTabs(): () => void {
		const target = this.#deps.window;
		if (target === null) return () => undefined;
		const onStorage = (event: Event): void => {
			const key = (event as StorageEvent).key;
			if (key !== TOKEN_KEY && key !== null) return;
			const stored = getToken();
			if (stored === this.#state.token) return;
			if (stored === null) {
				this.set(SIGNED_OUT);
				return;
			}
			void this.loadMe().catch(() => undefined);
		};
		target.addEventListener('storage', onStorage);
		return () => target.removeEventListener('storage', onStorage);
	}

	/**
	 * loadMe hydrates the user for the stored token (or `known`, a token the
	 * caller just received). With no token it stays signed out without calling
	 * the API.
	 */
	async loadMe(known?: string): Promise<User | null> {
		// A token the caller just received wins over storage, which may be blocked.
		const stored = known ?? getToken();
		if (!stored) {
			this.set(SIGNED_OUT);
			// Booting without a session: nothing saved may linger for the next sign-in.
			this.#forgetOfflineCopies();
			return null;
		}
		// Boot: hydrate the token before the round-trip so a transient network
		// failure does not bounce a signed-in user back to /login. A token the
		// caller just received (login) is not announced until `me` has answered,
		// so a failing `me` cannot flip the guard away from the page that shows
		// the error. Signed in already (a reload of `me`, or another tab's new
		// token), the user is never blanked: the session stays until `me` names
		// another user (record 0009).
		if (known === undefined && this.#state.user === null) this.set({ token: stored, user: null });

		const me = await this.#deps.api<User>('/api/auth/me');
		this.set({ token: stored, user: me });
		this.#followAccountLanguage(me);
		// Offline copies of any other credential (another user on this device, an
		// earlier login of this one) are not this session's: remove them.
		void ownPartition(stored).then((own) => cleanupPartitions(undefined, own), () => undefined);
		return me;
	}

	/**
	 * signIn exchanges credentials for a bearer token (stored under
	 * `qinqin.token`) and loads its user, or, for a user with a second factor,
	 * returns the challenge to answer: no token exists before that step. Status
	 * `password_change_required` and `mfa_enrollment_required` are signed-in
	 * sessions too: `me` reports the restriction and the layout guard sends the
	 * user to the page they may use.
	 */
	async signIn(username: string, password: string): Promise<SignInResult> {
		return this.#settle(
			await this.#deps.api<LoginBody>('/api/auth/login', { method: 'POST', body: { username, password } })
		);
	}

	/** completeMfa answers the second step; the result may itself be a session only. */
	async completeMfa(challenge: string, method: string, code: string): Promise<SignInResult> {
		return this.#settle(await mfaStep(challenge, method, code));
	}

	/** completeEmailLogin answers an emailed sign-in code (may lead to a second step). */
	async completeEmailLogin(challenge: string, code: string): Promise<SignInResult> {
		return this.#settle(await emailLoginVerify(challenge, code));
	}

	/**
	 * login is signIn for callers that cannot show a second step (the first
	 * sign-in right after registering): a challenge is an error there.
	 */
	async login(username: string, password: string): Promise<User> {
		const result = await this.signIn(username, password);
		if (result.kind === 'mfa') throw new UserError('auth.error.secondStepNeeded');
		return result.user;
	}

	/**
	 * signInWithToken stores a token the server just issued (login, reset link)
	 * and loads its user. A token without a user is no session: when `me` fails
	 * the token is forgotten (a 401 already did) so the page can show the error.
	 */
	async signInWithToken(token: string): Promise<User> {
		setToken(token);
		try {
			const me = await this.loadMe(token);
			if (!me) throw new Error('login did not return a user');
			return me;
		} catch (err) {
			clearToken();
			if (this.#state.token !== null || this.#state.user !== null) this.set(SIGNED_OUT);
			throw err;
		}
	}

	/**
	 * register creates the account and signs it in. The first account on a
	 * fresh instance becomes admin; afterwards the API requires an admin token,
	 * so callers on the register page are unauthenticated.
	 */
	async register(
		username: string,
		password: string,
		extra: { email?: string; invite?: string } = {}
	): Promise<User> {
		const body: Record<string, string> = { username, password };
		if (extra.email) body.email = extra.email;
		if (extra.invite) body.invite = extra.invite;
		const created = await this.#deps.api<User>('/api/auth/register', { method: 'POST', body });
		await this.login(username, password);
		return created;
	}

	/**
	 * logout ends the session on the server (best effort), then forgets the token
	 * and the user; the app context disposes the session (`signOut`). The layout
	 * guard notices the signed-out session and leaves any protected page, so
	 * there is no navigation here to fail or double up.
	 */
	logout(): void {
		// This device's web push subscription goes with the session (#139): best effort, and started here so the
		// request still carries the token cleared next.
		forgetThisDevice({ api: this.#deps.api, env: browserPushEnv(), user: this.user?.id ?? null });
		// Best effort, and sent before the token is cleared (the request carries it).
		if (getToken() !== null) {
			this.#deps.api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
		}
		clearToken();
		this.set(SIGNED_OUT, 'signOut');
		// Device state that is not kept per user: offline API copies and receipts.
		this.#forgetOfflineCopies();
	}

	/** Turns a login-shaped answer into a stored session or a second step. */
	async #settle(response: LoginBody): Promise<SignInResult> {
		const step = stepFor(response.status, response);
		// A status this client does not know must not store a session.
		if (step.kind === 'mfa') return { kind: 'mfa', mfa: step.mfa };
		if (!hasSession(step) || !response.token) throw new UserError('auth.error.stepUnsupported');
		return { kind: 'session', user: await this.signInWithToken(response.token), step };
	}

	/** Offline copies of the API (all partitions) and the "prepared" receipts. Best effort. */
	#forgetOfflineCopies(): void {
		void cleanupPartitions(undefined, null);
		try {
			clearReceipts(this.#deps.local());
		} catch {
			// Storage denied.
		}
	}

	/**
	 * The account's interface language, mirrored for the next start outside a workspace. Whether the page reloads into
	 * another language is decided once the workspace is known too (routes/+layout.svelte, followInterfaceLanguage).
	 */
	#followAccountLanguage(me: User): void {
		const browser = typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
		writeMirror(this.#deps.local(), resolveInterfaceLanguage(me.interfaceLanguage ?? '', browser));
	}
}
