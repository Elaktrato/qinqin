// The Chromium install prompt (record 0009: tab-wide, owned by the app
// context): `beforeinstallprompt` is deferred so the Settings button can ask
// instead of the browser's own bar; it can be shown once.

interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export class InstallPrompt {
	#event = $state.raw<InstallPromptEvent | null>(null);

	/** Whether a deferred prompt is waiting. */
	get available(): boolean {
		return this.#event !== null;
	}

	/** capture listens on `target` (the window) for the install events; returns the unsubscribe. */
	capture(target: EventTarget | null): () => void {
		if (target === null) return () => undefined;
		const onPrompt = (event: Event): void => {
			// Keep the browser from showing its own bar: the Settings button asks.
			event.preventDefault();
			this.#event = event as InstallPromptEvent;
		};
		const onInstalled = (): void => {
			this.#event = null;
		};
		target.addEventListener('beforeinstallprompt', onPrompt);
		target.addEventListener('appinstalled', onInstalled);
		return () => {
			target.removeEventListener('beforeinstallprompt', onPrompt);
			target.removeEventListener('appinstalled', onInstalled);
		};
	}

	/** prompt shows the browser's install dialog once per captured prompt. */
	async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
		const event = this.#event;
		if (event === null) return 'unavailable';
		this.#event = null;
		try {
			await event.prompt();
			return (await event.userChoice).outcome;
		} catch {
			return 'dismissed';
		}
	}
}
