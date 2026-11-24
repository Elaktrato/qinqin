// The app context (record 0009): one per tab, created by the root layout and
// disposed when it unmounts. It holds what is tab-wide and outlives a sign-in
// (auth, and the tab's other state as later tasks add it) and the current
// session, which it follows from auth: a session exists while a token does, a
// user other than the session's ends it (`switched`), a sign-out or a 401 ends
// it with that reason.

import { setApiObserver } from '../api/client';
import { reportNetworkFailure, reportResponse } from '../pwa/offlineState';
import { endSession } from '../session/sessionEnd';
import { setOutboxUser } from '../study/outboxUser';
import { Auth, type AuthState } from '../auth.svelte';
import type { AppDeps } from './deps';
import { createSession, type Session, type SessionEndReason } from './session.svelte';

export class AppContext {
	readonly deps: AppDeps;
	readonly auth: Auth;
	#session = $state.raw<Session | null>(null);
	readonly #stops: Array<() => void> = [];

	constructor(deps: AppDeps) {
		this.deps = deps;
		this.auth = new Auth(deps, (state, reason) => this.#follow(state, reason));
	}

	/** The current session, or null while signed out. */
	get session(): Session | null {
		return this.#session;
	}

	/**
	 * start connects the context to the tab: the API client's observer (a 401,
	 * a restriction) and the other tabs' sign-ins. Returns the stop.
	 */
	start(): () => void {
		setApiObserver({
			unauthorized: () => this.auth.expire(),
			restricted: () => this.auth.restricted(),
			workspaceGone: () => void this.#session?.recovery.recover(),
			answered: (headers) => reportResponse(headers),
			unreachable: () => reportNetworkFailure()
		});
		const stopTabs = this.auth.followTabs();
		const stop = (): void => {
			stopTabs();
			setApiObserver(null);
		};
		this.#stops.push(stop);
		return stop;
	}

	/** dispose ends the current session and stops what start connected. */
	dispose(): void {
		for (const stop of this.#stops.splice(0)) stop();
		this.#end('switched');
	}

	#follow(state: AuthState, reason: SessionEndReason | undefined): void {
		const id = state.user?.id ?? null;
		setOutboxUser(id);
		const current = this.#session;
		if (current !== null && (state.token === null || (current.user !== null && id !== current.user))) {
			this.#end(reason ?? 'switched');
		}
		if (state.token === null) return;
		if (this.#session === null) this.#session = createSession({ ...this.deps, auth: this.auth }, id);
		else if (id !== null) this.#session.adopt(id);
	}

	#end(reason: SessionEndReason): void {
		const current = this.#session;
		if (current === null) return;
		this.#session = null;
		current.dispose(reason);
		// The caches not moved into the session yet (#196 migrates them task by task).
		endSession(reason);
	}
}

/** createAppContext builds the tab's app context. */
export function createAppContext(deps: AppDeps): AppContext {
	return new AppContext(deps);
}
