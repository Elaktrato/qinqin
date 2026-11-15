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
