// The per-session context (record 0009): one object per signed-in session,
// created by the app context when a token appears and disposed when the session
// ends. It owns every per-user cache and state object; disposing it stops their
// timers and listeners. An answer that arrives after the dispose lands in the
// disposed objects, which nothing reads any more: the next session is a new set
// of objects, so nothing of one account is reachable from the next.

import type { Auth } from '../auth.svelte';
import type { AppDeps } from './deps';

/** Why the session ended: only `signOut` also forgets the device's workspace choice. */
export type SessionEndReason = 'signOut' | 'expired' | 'switched';

export interface SessionDeps extends AppDeps {
	/** The tab's auth: the token the session's requests carry. */
	auth: Pick<Auth, 'token' | 'user'>;
}

type Disposer = (reason: SessionEndReason) => void;

export class Session {
	readonly deps: SessionDeps;
	#user = $state<number | null>(null);
	#alive = $state(true);
	#reason: SessionEndReason | null = null;
	readonly #disposers: Disposer[] = [];

	constructor(deps: SessionDeps, user: number | null) {
		this.deps = deps;
		this.#user = user;
	}

	/** The signed-in user's id; null until `me` answered (a boot offline). */
	get user(): number | null {
		return this.#user;
	}

	/** False once the session ended. */
	get alive(): boolean {
		return this.#alive;
	}

	/** adopt: `me` named the user of a session that did not know it yet. */
	adopt(user: number): void {
		if (this.#user === null && this.#alive) this.#user = user;
	}

	/**
	 * onDispose registers `fn` to run when the session ends (with the reason);
	 * returns the unregister. Registered after the end, it runs at once.
	 */
	onDispose(fn: Disposer): () => void {
		if (this.#reason !== null) {
			fn(this.#reason);
			return () => undefined;
		}
		this.#disposers.push(fn);
		return () => {
			const at = this.#disposers.indexOf(fn);
			if (at >= 0) this.#disposers.splice(at, 1);
		};
	}

	/** dispose ends the session once: every disposer runs in order; a throwing one is logged, the rest still run. */
	dispose(reason: SessionEndReason): void {
		if (this.#reason !== null) return;
		this.#reason = reason;
		this.#alive = false;
		for (const fn of this.#disposers.splice(0)) {
			try {
				fn(reason);
			} catch (err) {
				console.error('session end: a cache could not be cleared', err);
			}
		}
	}
}

/** createSession builds the session for `user` (null: not known yet). */
export function createSession(deps: SessionDeps, user: number | null): Session {
	return new Session(deps, user);
}
