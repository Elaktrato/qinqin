// A short-lived, shared cache of each workspace's decks and cards. Reading
// them is a full sync pull, and a reader popup shows several entries at
// once: each asks whether its entry is already studied, and all of them
// share one pull (in flight) and its answer (for STUDY_DATA_TTL_MS).
// Every study-data write (store.ts) drops the workspace's cached copy.

import { onSessionEnd } from '../session/sessionEnd';
import { createWorkspaceCache, type WorkspaceCache } from '../workspaceCache';
import { ALL_WORKSPACES, loadStudyDataFor, onStudyWrite } from './store';
import type { StudyCard, StudyData } from './types';

export const STUDY_DATA_TTL_MS = 30_000;

export type StudyDataLoader = (workspaceId: number) => Promise<StudyData>;

export type StudyDataCache = WorkspaceCache<StudyData>;

/** createStudyDataCache builds a cache around `load` (injected for tests). */
export function createStudyDataCache(
	load: StudyDataLoader,
	now: () => number = Date.now,
	ttl = STUDY_DATA_TTL_MS
): StudyDataCache {
	return createWorkspaceCache(load, now, ttl);
}

const shared = createStudyDataCache(loadStudyDataFor);
onSessionEnd(() => shared.invalidate());
onStudyWrite((workspaceId) =>
	shared.invalidate(workspaceId === ALL_WORKSPACES ? undefined : workspaceId)
);

/** getStudyData reads one workspace's decks and cards through the shared cache. */
export function getStudyData(workspaceId: number, opts?: { force?: boolean }): Promise<StudyData> {
	return shared.get(workspaceId, opts);
}

/** invalidateStudyData drops the shared cache of one workspace, or of all. */
export function invalidateStudyData(workspaceId?: number): void {
	shared.invalidate(workspaceId);
}

/**
 * hasCard reports whether the entry already has a vocab card: the card
 * the add buttons create, and the one addCard dedupes on.
 */
export function hasCard(cards: readonly StudyCard[], entryId: number): boolean {
	return cards.some((card) => card.kind === 'vocab' && card.entryId === entryId);
}
