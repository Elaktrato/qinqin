// The app context (record 0009): one per tab, created by the root layout and
// disposed when it unmounts. It holds what is tab-wide and outlives a sign-in
// (auth, connectivity, the install prompt, the service worker's update, the
// sign-out prompt, the theme, the navigation layout, the font faces and the
// page frame) and the current session, which it follows from auth: a session
// exists while a token does, a user other than the session's ends it
// (`switched`), a sign-out or a 401 ends it with that reason.

import { setApiObserver } from '../api/client';
import { createPackFaces, type PackFaces } from '../fonts/packFaces.svelte';
import { createNavLayoutStore, type NavLayoutStore } from '../frame/navLayoutStore.svelte';
import { PageFrame } from '../frame/pageFrame.svelte';
import { InstallPrompt } from '../pwa/installPrompt.svelte';
import { createThemeStore, type ThemeStore } from '../theme/store.svelte';
import { Connectivity } from '../pwa/offlineState.svelte';
import { createWorkerRegistration, type WorkerRegistration } from '../pwa/register.svelte';
import { Auth, type AuthState } from '../auth.svelte';
import type { AppDeps } from './deps';
import { createSession, type Session, type SessionEndReason } from './session.svelte';

export class AppContext {
	readonly deps: AppDeps;
	readonly auth: Auth;
	/** Online or not, saved copies, the queued and prepared counts (the offline banner). */
	readonly offline: Connectivity;
	/** The deferred browser install prompt. */
	readonly install = new InstallPrompt();
	/** The service worker's registration and its waiting update. */
	readonly worker: WorkerRegistration;
	/** The installed themes, the person's appearance row and the device's light/dark switch. */
	readonly theme: ThemeStore;
	/** The person's phone navigation (bottom bar or side menu). */
	readonly navLayout: NavLayoutStore;
	/** The faces of the installed font packs. */
	readonly fonts: PackFaces;
	/** The phone bar's page title and actions. */
	readonly frame = new PageFrame();
	/** The number of unsent reviews the sign-out dialog is asking about; null = no dialog. */
	logoutPrompt = $state<number | null>(null);
	#session = $state.raw<Session | null>(null);
	readonly #stops: Array<() => void> = [];

	constructor(deps: AppDeps) {
		this.deps = deps;
		this.offline = new Connectivity({ now: deps.now, timers: deps.timers, browserOnline: deps.online });
		this.worker = createWorkerRegistration(
			deps.worker ?? { isSecureContext: false, serviceWorker: undefined, reload: () => undefined, setInterval: () => 0 }
		);
		this.theme = createThemeStore({ storage: deps.local });
		this.navLayout = createNavLayoutStore({ storage: deps.local, now: deps.now });
		this.fonts = createPackFaces();
		this.auth = new Auth(deps, (state, reason) => this.#follow(state, reason));
	}

	/** The current session, or null while signed out. */
	get session(): Session | null {
		return this.#session;
	}

	/**
	 * start connects the context to the tab: the API client's observer (a 401,
	 * a restriction, a deleted workspace, every answer), the other tabs'
	 * sign-ins, the browser's online events, the install prompt and the
	 * service worker. Returns the stop.
	 */
	start(): () => void {
		setApiObserver({
			unauthorized: () => this.auth.expire(),
			restricted: () => this.auth.restricted(),
			workspaceGone: () => void this.#session?.recovery.recover(),
			answered: (headers) => this.offline.reportResponse(headers),
			unreachable: () => this.offline.reportNetworkFailure()
		});
		const stops = [
			this.auth.followTabs(),
			this.offline.watch(this.deps.window),
			this.install.capture(this.deps.window as EventTarget | null)
		];
		void this.worker.register();
		const stop = (): void => {
			for (const fn of stops) fn();
			setApiObserver(null);
		};
		this.#stops.push(stop);
		return stop;
	}

	/** dispose ends the current session and stops what start connected. */
	dispose(): void {
		for (const stop of this.#stops.splice(0)) stop();
		this.#end('switched');
		this.offline.dispose();
	}

	#follow(state: AuthState, reason: SessionEndReason | undefined): void {
		const id = state.user?.id ?? null;
		const current = this.#session;
		if (current !== null && (state.token === null || (current.user !== null && id !== current.user))) {
			this.#end(reason ?? 'switched');
		}
		if (state.token === null) return;
		if (this.#session === null) this.#session = createSession({ ...this.deps, auth: this.auth, offline: this.offline }, id);
		else if (id !== null) this.#session.adopt(id);
	}

	#end(reason: SessionEndReason): void {
		const current = this.#session;
		if (current === null) return;
		this.#session = null;
		this.logoutPrompt = null;
		current.dispose(reason);
		this.offline.endSession();
	}
}

/** createAppContext builds the tab's app context. */
export function createAppContext(deps: AppDeps): AppContext {
	return new AppContext(deps);
}
