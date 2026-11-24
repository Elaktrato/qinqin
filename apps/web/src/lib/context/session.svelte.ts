// The per-session context (record 0009): one object per signed-in session,
// created by the app context when a token appears and disposed when the session
// ends. It owns every per-user cache and state object; disposing it stops their
// timers and listeners. An answer that arrives after the dispose lands in the
// disposed objects, which nothing reads any more: the next session is a new set
// of objects, so nothing of one account is reachable from the next.

import type { Auth } from '../auth.svelte';
import { EventLog } from '../events';
import { PluginStates } from '../plugins/states.svelte';
import { currentStudyDay, whenStudyDaySettled } from '../time/zone';
import { Notices } from '../notices.svelte';
import type { Connectivity } from '../pwa/offlineState.svelte';
import { createStudyState, type StudyState } from '../study/data';
import { ReviewOutbox } from '../study/events';
import { clearRecentSent, rememberSent } from '../study/recentSent';
import { WorkspaceRecovery } from '../workspaceGone';
import { Workspaces } from '../workspaces.svelte';
import { createPlayer, type Player } from '../audio/player';
import { clipObjectUrl, readyClipUrl } from '../audio/source';
import { SessionCaches } from './caches';
import type { AppDeps } from './deps';

/** Why the session ended: only `signOut` also forgets the device's workspace choice. */
export type SessionEndReason = 'signOut' | 'expired' | 'switched';

export interface SessionDeps extends AppDeps {
	/** The tab's auth: the token the session's requests carry. */
	auth: Pick<Auth, 'token' | 'user'>;
	/** The tab's connectivity: the outbox reports its queue there. */
	offline: Pick<Connectivity, 'setQueued' | 'notifyAllSent'>;
}

type Disposer = (reason: SessionEndReason) => void;

export class Session {
	readonly deps: SessionDeps;
	#user = $state<number | null>(null);
	#alive = $state(true);
	#reason: SessionEndReason | null = null;
	readonly #disposers: Disposer[] = [];

	/** The one-line notice of the shell. */
	readonly notices = new Notices();
	/** The caller's plugin and feature states. */
	readonly plugins: PluginStates;
	/** Event posting and the short-lived log cache of the widgets. */
	readonly events: EventLog;
	/** The user's workspaces and the one in use. */
	readonly workspaces: Workspaces;
	/** The reload after a workspace was deleted elsewhere. */
	readonly recovery: WorkspaceRecovery;
	/** The review outbox: the user's queued reviews, sent with this session's token. */
	readonly outbox: ReviewOutbox;
	/** The study data: the study cache of #193 and what derives from it. */
	readonly study: StudyState;
	/** The caches of server answers (audio, characters, entry bases, schemes, clips, ...). */
	readonly caches = new SessionCaches();
	#player: Player | null = null;

	constructor(deps: SessionDeps, user: number | null) {
		this.deps = deps;
		this.#user = user;
		const { api, local, session, now } = deps;
		this.plugins = new PluginStates({ api, alive: () => this.alive });
		this.events = new EventLog({
			api,
			now,
			timers: deps.timers,
			local,
			manifests: () => this.plugins.manifests,
			studyDay: () => currentStudyDay(),
			whenStudyDaySettled: () => whenStudyDaySettled()
		});
		this.onDispose(() => this.events.dispose());
		this.workspaces = new Workspaces({ api, local, session, alive: () => this.alive });
		this.onDispose((reason) => this.workspaces.dispose(reason));
		this.recovery = new WorkspaceRecovery({ workspaces: this.workspaces, notices: this.notices, now, local, session });
		this.outbox = new ReviewOutbox({
			post: (events) => this.events.post(events),
			local,
			now,
			timers: deps.timers,
			window: deps.window,
			document: deps.document,
			user: () => this.#user,
			token: () => deps.auth.token,
			notify: (text) => this.notices.show(text),
			setQueued: (count) => deps.offline.setQueued(count),
			allSent: () => deps.offline.notifyAllSent(),
			rememberSent: (userId, events) => rememberSent(userId, events, now(), local())
		});
		this.onDispose(() => this.outbox.dispose());
		this.study = createStudyState({
			api,
			now,
			timers: deps.timers,
			local,
			user: () => this.#user,
			alive: () => this.alive,
			outbox: this.outbox,
			events: this.events
		});
		this.onDispose((reason) => {
			this.#player?.stop();
			this.study.dispose();
			this.caches.clear();
			// Reviews sent lately are kept per user id; an explicit sign-out still drops them.
			if (reason === 'signOut') clearRecentSent(local());
		});
	}

	/**
	 * The one audio player of the session, created on first use (browser
	 * only): it plays clips through the session's clip cache, and the end of
	 * the session stops it.
	 */
	get player(): Player {
		this.#player ??= createPlayer(
			undefined,
			undefined,
			(url) => clipObjectUrl(this.caches.clips, url),
			(url) => readyClipUrl(this.caches.clips, url)
		);
		return this.#player;
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
		if (this.#user !== null || !this.#alive) return;
		this.#user = user;
		this.outbox.userKnown();
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
