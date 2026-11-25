// The facts publisher (#137): debounced (5 s, trailing) and at most one run a minute. A run reads the reminder
// settings fresh and publishes the facts only when the account enabled reminders (an account that never opted in
// publishes nothing); then `after` runs (the device scheduler's replan: facts FIRST, then replan). It never
// throws into the UI: every failure is a console warning and the next request tries again.

import type { Timers } from '$lib/context/deps';

export const DEBOUNCE_MS = 5000;
export const MIN_GAP_MS = 60_000;

export interface FactsPublisherDeps {
	timers: Timers;
	now: () => number;
	/** Whether the account's reminders are enabled, read fresh. */
	enabled: () => Promise<boolean>;
	workspaces: () => number[];
	publish: (workspaceId: number) => Promise<void>;
	/**
	 * Runs after every run, enabled or not (the scheduler's replan notices an opt-out and cancels). `published` is
	 * false when the settings could not be read or a workspace's facts could not be sent: the server's plan is then
	 * built from older facts.
	 */
	after?: (result: { published: boolean }) => Promise<void>;
	debounceMs?: number;
	minGapMs?: number;
}

export interface FactsPublisher {
	/** A moment that may have changed the facts (start, a study change, a sync, a settings change). */
	request(): void;
	stop(): void;
}

export function createFactsPublisher(deps: FactsPublisherDeps): FactsPublisher {
	const debounce = deps.debounceMs ?? DEBOUNCE_MS;
	const gap = deps.minGapMs ?? MIN_GAP_MS;
	let timer: unknown = null;
	let stopped = false;
	let running = false;
	let again = false;
	let lastRun = -Infinity;

	async function run(): Promise<void> {
		running = true;
		lastRun = deps.now();
		try {
			let on = false;
			let published = true;
			try {
				on = await deps.enabled();
			} catch (err) {
				published = false;
				console.warn('reminders: the settings could not be read', err);
			}
			if (on) {
				for (const workspace of deps.workspaces()) {
					if (stopped) return;
					try {
						await deps.publish(workspace);
					} catch (err) {
						published = false;
						console.warn('reminders: the facts could not be published', err);
					}
				}
			}
			if (!stopped) await deps.after?.({ published }).catch((err) => console.warn('reminders: after-publish step failed', err));
		} finally {
			running = false;
			if (again && !stopped) {
				again = false;
				schedule();
			}
		}
	}

	function schedule(): void {
		if (timer !== null) deps.timers.clear(timer);
		const wait = Math.max(debounce, lastRun + gap - deps.now());
		timer = deps.timers.set(() => {
			timer = null;
			void run();
		}, wait);
	}

	return {
		request() {
			if (stopped) return;
			if (running) again = true;
			else schedule();
		},
		stop() {
			stopped = true;
			if (timer !== null) deps.timers.clear(timer);
			timer = null;
		}
	};
}
