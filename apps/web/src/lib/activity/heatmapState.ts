// Pure helpers of the home heatmap's view state.

import type { ActivityView } from './activity';
import type { StoredActivityView } from './viewPrefs';

/** effectiveScope is the scope drawn: without a workspace only the combined view exists. */
export function effectiveScope(
	stored: StoredActivityView['scope'],
	hasWorkspace: boolean
): StoredActivityView['scope'] {
	return hasWorkspace ? stored : 'all';
}

/** toggleHidden returns the hidden list with `type` added, or removed when present. */
export function toggleHidden(hidden: readonly string[], type: string): string[] {
	return hidden.includes(type) ? hidden.filter((t) => t !== type) : [...hidden, type];
}

/** activityViewFor maps the stored view and the active workspace to what `foldActivity` takes. */
export function activityViewFor(stored: StoredActivityView, workspace: number | null): ActivityView {
	return {
		workspace: effectiveScope(stored.scope, workspace !== null) === 'all' ? null : workspace,
		hidden: stored.hidden
	};
}

/** The remembered view while it loads: `dirty` once the user changed it locally. */
export interface PrefsState {
	stored: StoredActivityView;
	loaded: boolean;
	dirty: boolean;
}

export function initialPrefs(): PrefsState {
	return { stored: { scope: 'workspace', hidden: [] }, loaded: false, dirty: false };
}

/** prefsLoaded applies the server's value, unless the user already changed the view. */
export function prefsLoaded(state: PrefsState, fromServer: StoredActivityView): PrefsState {
	return state.dirty ? { ...state, loaded: true } : { stored: fromServer, loaded: true, dirty: false };
}

/** prefsChanged records a local change, which a later load never overwrites. */
export function prefsChanged(state: PrefsState, next: StoredActivityView): PrefsState {
	return { ...state, stored: next, dirty: true };
}

/**
 * heatmapStatus: the card shows its content only once the data and the
 * remembered view are both in, so the scope never jumps after first
 * paint; an error needs a failed request without data.
 */
export function heatmapStatus(s: {
	hasData: boolean;
	loading: boolean;
	prefsLoaded: boolean;
}): 'loading' | 'error' | 'ready' {
	if (!s.hasData) return s.loading ? 'loading' : 'error';
	return s.prefsLoaded ? 'ready' : 'loading';
}

/** createSequencer numbers requests so a slow earlier one can be told from the latest. */
export function createSequencer(): { next(): number; isCurrent(token: number): boolean } {
	let latest = 0;
	return {
		next: () => ++latest,
		isCurrent: (token) => token === latest
	};
}

/**
 * createSaveQueue runs saves one at a time: while one is in flight,
 * pushes keep only the newest value, which is saved next, so the last
 * change always wins and writes never overtake each other. A failed
 * save is reported and does not stop the queue.
 */
export function createSaveQueue<T>(
	save: (value: T) => Promise<void>,
	onError: (err: unknown) => void
): { push(value: T): Promise<void> } {
	let pending: { value: T } | null = null;
	let running: Promise<void> | null = null;

	async function drain(): Promise<void> {
		while (pending) {
			const { value } = pending;
			pending = null;
			try {
				await save(value);
			} catch (err) {
				onError(err);
			}
		}
		running = null;
	}

	return {
		push(value) {
			pending = { value };
			running ??= drain();
			return running;
		}
	};
}

/** chipLabel is a chip's accessible name: the type and its points with the unit. */
export function chipLabel(label: string, points: number): string {
	return `${label}, ${points} ${points === 1 ? 'point' : 'points'}`;
}
