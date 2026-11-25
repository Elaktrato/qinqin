// The heatmap's view (scope and hidden activity types), remembered per
// user across devices in a keyed row (docs/contracts/keyed/). Last write wins; a
// corrupt stored value reads as the default.

import { keyedData } from '../sync/keyed';

export const ACTIVITY_VIEW_KEY = 'activity-view';

export interface StoredActivityView {
	scope: 'workspace' | 'all';
	hidden: string[];
}

export const DEFAULT_ACTIVITY_VIEW: StoredActivityView = { scope: 'workspace', hidden: [] };

/**
 * parseActivityView reads a stored value: anything that is not a
 * version 1 object is the default; inside one, an unknown scope falls
 * back to "workspace" and non-string (or repeated) hidden entries drop.
 */
export function parseActivityView(value: unknown): StoredActivityView {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ...DEFAULT_ACTIVITY_VIEW, hidden: [] };
	}
	const v = value as { version?: unknown; scope?: unknown; hidden?: unknown };
	if (v.version !== 1) return { ...DEFAULT_ACTIVITY_VIEW, hidden: [] };
	const hidden = Array.isArray(v.hidden)
		? [...new Set(v.hidden.filter((t): t is string => typeof t === 'string'))]
		: [];
	return { scope: v.scope === 'all' ? 'all' : 'workspace', hidden };
}

/** loadActivityView reads the user's view; any failure reads as the default. */
export async function loadActivityView(): Promise<StoredActivityView> {
	try {
		return parseActivityView(
			await keyedData(null).find(ACTIVITY_VIEW_KEY)
		);
	} catch {
		return { ...DEFAULT_ACTIVITY_VIEW, hidden: [] };
	}
}

/** saveActivityView stores the view for every device. */
export async function saveActivityView(view: StoredActivityView): Promise<void> {
	await keyedData(null).put(ACTIVITY_VIEW_KEY, { version: 1, scope: view.scope, hidden: view.hidden });
}
