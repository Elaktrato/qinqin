// Page side of the service worker: registers it (secure contexts only),
// notices an update waiting behind the running worker, and applies it on the
// user's say-so. The worker never takes over by itself (see sw/lifecycle.ts).


interface WorkerLike extends EventTarget {
	state: string;
	postMessage(message: unknown): void;
}
interface RegistrationLike extends EventTarget {
	waiting: WorkerLike | null;
	installing: WorkerLike | null;
	update(): Promise<unknown>;
}
interface ContainerLike extends EventTarget {
	controller: object | null;
	register(url: string, options?: { scope?: string; updateViaCache?: string }): Promise<RegistrationLike>;
}

export interface RegistrationEnv {
	isSecureContext: boolean;
	serviceWorker: ContainerLike | undefined;
	reload(): void;
	setInterval(handler: () => void, ms: number): number;
}

const HOUR_MS = 3_600_000;

export interface WorkerRegistration {
	/** True while a new version is installed and waiting for the user's Reload. */
	readonly updateAvailable: boolean;
	register(): Promise<void>;
	/** Asks the waiting worker to take over; the page reloads once when it does. */
	apply(): void;
}

export function createWorkerRegistration(env: RegistrationEnv): WorkerRegistration {
	let available = $state(false);
	let registration: RegistrationLike | null = null;
	let applying = false;
	let reloaded = false;
	let wasControlled = false;

	async function register(): Promise<void> {
		const container = env.serviceWorker;
		// Install and offline need HTTPS (or localhost); elsewhere the app is
		// exactly what it was without a worker.
		if (!env.isSecureContext || container === undefined) return;
		try {
			// The page was already controlled: a worker installed from now on is an
			// update. Without a controller it is the first install (nothing to offer).
			const hadController = container.controller !== null;
			wasControlled = hadController;
			registration = await container.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
			const reg = registration;
			if (hadController && reg.waiting) available = true;
			reg.addEventListener('updatefound', () => {
				const worker = reg.installing;
				if (!worker) return;
				worker.addEventListener('statechange', () => {
					if (worker.state === 'installed' && container.controller !== null) available = true;
				});
			});
			container.addEventListener('controllerchange', () => {
				// Only the user's Reload may swap the code under an open page. A tab
				// that did not press it (another tab did) offers the Reload instead.
				if (!applying) {
					if (wasControlled) available = true;
					return;
				}
				if (reloaded) return;
				reloaded = true;
				env.reload();
			});
			env.setInterval(() => void reg.update().catch(() => undefined), HOUR_MS);
		} catch {
			// Registration is an enhancement; the app works without it.
		}
	}

	function apply(): void {
		applying = true;
		const waiting = registration?.waiting;
		if (waiting) {
			waiting.postMessage({ type: 'skip-waiting' });
			return;
		}
		// Already taken over (another tab applied it): only this page is old.
		if (!reloaded) {
			reloaded = true;
			env.reload();
		}
	}

	return {
		get updateAvailable() {
			return available;
		},
		register,
		apply
	};
}

/** browserRegistrationEnv: the page's service worker container (the app context's registration). */
export function browserRegistrationEnv(): RegistrationEnv {
	return {
		get isSecureContext() {
			return typeof window !== 'undefined' && window.isSecureContext === true;
		},
		get serviceWorker() {
			return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
				? (navigator.serviceWorker as unknown as ContainerLike)
				: undefined;
		},
		reload: () => location.reload(),
		setInterval: (handler, ms) => window.setInterval(handler, ms)
	};
}
