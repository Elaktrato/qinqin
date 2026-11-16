// The widgets' read of a workspace's study history (decks, merged cards,
// reviews): loadStudyData through a short-lived shared cache, with the
// event log read through the shared log cache (events.ts). Home and the
// Stats overview show several widgets that each need it; they now share
// one sync pull and one log read. Pages that schedule or write cards
// (routes/study/**) and the character map keep the uncached loadStudyData.
//
// Dropped on every study-data write (onStudyWrite) and whenever a review
// or read event is posted (onEventLogChange). The returned object is
// shared between widgets: do not mutate it.

import { invalidateWorkspaceEvents, loadWorkspaceEvents, onEventLogChange } from '../events';
import { createWorkspaceCache } from '../workspaceCache';
import { ALL_WORKSPACES, loadStudyDataWith, onStudyWrite } from './store';
import type { StudyHistory } from './types';

export const STUDY_HISTORY_TTL_MS = 8_000;

const history = createWorkspaceCache(
	(workspaceId: number) => loadStudyDataWith(workspaceId, (id) => loadWorkspaceEvents(id)),
	() => Date.now(),
	STUDY_HISTORY_TTL_MS
);

onStudyWrite((workspaceId) =>
	history.invalidate(workspaceId === ALL_WORKSPACES ? undefined : workspaceId)
);
onEventLogChange((workspaceId) => history.invalidate(workspaceId));

/**
 * loadStudyHistory is loadStudyData(workspaceId) for widgets, cached.
 * `force` (a widget's "Try again") reads the pull and the log again.
 */
export function loadStudyHistory(
	workspaceId: number,
	opts?: { force?: boolean }
): Promise<StudyHistory> {
	if (opts?.force) {
		invalidateWorkspaceEvents(workspaceId);
		history.invalidate(workspaceId);
	}
	return history.get(workspaceId);
}

/** invalidateStudyHistory drops the cached history of one workspace, or of all. */
export function invalidateStudyHistory(workspaceId?: number): void {
	history.invalidate(workspaceId);
}
