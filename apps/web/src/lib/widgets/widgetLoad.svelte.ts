// A widget's load with the last value kept (#290): a widget mounted again
// shows what it showed last for the same workspace at once, held for the
// session (SessionCaches.held, record 0009), and refreshes it behind. The
// loading line is only for a true first load; a failed refresh keeps the value
// with a quiet notice (`stale`), a failed first load is an error. A runes
// class a component creates for its own lifetime.

import { untrack } from 'svelte';
import type { Session } from '$lib/context/session.svelte';

/** The key of a widget's value in one scope (a workspace id, or a widget's own scope string). */
function heldKey(widget: string, scope: string | number): string {
	return `${widget}\u0000${scope}`;
}

/** heldValue: the value the widget last showed in this scope during the session, if any. */
export function heldValue<T>(session: Session, widget: string, scope: string | number): T | undefined {
	return session.caches.held.values.get(heldKey(widget, scope)) as T | undefined;
}

/** holdValue keeps the value the widget shows (not after the session ended). */
export function holdValue<T>(session: Session, widget: string, scope: string | number, value: T): void {
	if (session.alive) session.caches.held.values.set(heldKey(widget, scope), value);
}

export class WidgetLoad<T> {
	/** The value shown: the last load's, or the held one until it answers. */
	value = $state.raw<T | null>(null);
	/** A first load runs: nothing to show yet. */
	loading = $state(false);
	/** The first load failed (nothing shown). */
	error = $state('');
	/** A refresh failed while a value is shown: the quiet notice. */
	stale = $state('');

	readonly #session: Session;
	readonly #widget: string;
	#scope: string | null = null;
	#seq = 0;

	/** `scope` is the workspace (or scope) the widget will load first: its held value shows at once. */
	constructor(session: Session, widget: string, scope: string | number | null) {
		this.#session = session;
		this.#widget = widget;
		if (scope !== null) this.#enter(scope);
	}

	/**
	 * run loads the scope's value; an older run that answers last is dropped.
	 * `load` may call `show` with a first value before it finishes.
	 * Called from an effect, it reads none of its own state there (untracked),
	 * so showing the value does not run the effect again.
	 */
	async run(
		scope: string | number,
		load: (show: (value: T) => void) => Promise<T>,
		failText: (err: unknown) => string
	): Promise<void> {
		const seq = ++this.#seq;
		untrack(() => {
			if (String(scope) !== this.#scope) this.#enter(scope);
			this.error = '';
			this.loading = this.value === null;
		});
		try {
			// A two-step load shows its first value early (the rest still runs).
			const show = (value: T): void => {
				if (seq !== this.#seq) return;
				this.value = value;
				this.loading = false;
			};
			const value = await load(show);
			if (seq !== this.#seq) return;
			this.value = value;
			this.stale = '';
			holdValue(this.#session, this.#widget, scope, value);
		} catch (err) {
			if (seq !== this.#seq) return;
			if (this.value === null) this.error = failText(err);
			else this.stale = failText(err);
		} finally {
			if (seq === this.#seq) this.loading = false;
		}
	}

	/** clear drops the shown value and any load in flight (no workspace, the feature switched off). */
	clear(): void {
		this.#seq++;
		this.#scope = null;
		untrack(() => {
			this.value = null;
			this.loading = false;
			this.error = '';
			this.stale = '';
		});
	}

	#enter(scope: string | number): void {
		this.#scope = String(scope);
		this.value = heldValue<T>(this.#session, this.#widget, scope) ?? null;
		this.loading = this.value === null;
		this.stale = '';
	}
}
