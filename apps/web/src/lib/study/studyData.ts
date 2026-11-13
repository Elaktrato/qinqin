// A short-lived, shared cache of each workspace's decks and cards. Reading
// them is a full sync pull, and a reader popup shows several entries at
// once: each asks whether its entry is already studied, and all of them
// share one pull (in flight) and its answer (for STUDY_DATA_TTL_MS).
// Every study-data write (store.ts) drops the workspace's cached copy.

import { loadStudyDataFor, onStudyWrite } from './store';
import type { StudyCard, StudyData } from './types';

export const STUDY_DATA_TTL_MS = 30_000;

export type StudyDataLoader = (workspaceId: number) => Promise<StudyData>;

export interface StudyDataCache {
	/** The workspace's study data: cached, joined to a load in flight, or loaded. `force` skips the cached copy. */
	get(workspaceId: number, opts?: { force?: boolean }): Promise<StudyData>;
	/** Drops the cached copy (and forgets a load in flight) of one workspace, or of all. */
	invalidate(workspaceId?: number): void;
}

interface Slot {
	/** Bumped by invalidate: a load started before it is not stored. */
	generation: number;
	cached: { data: StudyData; at: number } | null;
	inFlight: Promise<StudyData> | null;
}

/** createStudyDataCache builds a cache around `load` (injected for tests). */
export function createStudyDataCache(
	load: StudyDataLoader,
	now: () => number = Date.now,
	ttl = STUDY_DATA_TTL_MS
): StudyDataCache {
	const slots = new Map<number, Slot>();

	function slot(workspaceId: number): Slot {
		let found = slots.get(workspaceId);
		if (!found) {
			found = { generation: 0, cached: null, inFlight: null };
			slots.set(workspaceId, found);
		}
		return found;
	}

	return {
		get(workspaceId, opts = {}) {
			const s = slot(workspaceId);
			if (!opts.force && s.cached && now() - s.cached.at < ttl) {
				return Promise.resolve(s.cached.data);
			}
			// A load in flight started after the last invalidate: fresh enough
			// even for `force`.
			if (s.inFlight) return s.inFlight;
			const generation = s.generation;
			const promise = load(workspaceId).then(
				(data) => {
					if (s.generation === generation) {
						s.cached = { data, at: now() };
						s.inFlight = null;
					}
					return data;
				},
				(err: unknown) => {
					if (s.generation === generation) s.inFlight = null;
					throw err;
				}
			);
			s.inFlight = promise;
			return promise;
		},
		invalidate(workspaceId) {
			const targets = workspaceId === undefined ? [...slots.values()] : [slots.get(workspaceId)];
			for (const s of targets) {
				if (!s) continue;
				s.generation++;
				s.cached = null;
				s.inFlight = null;
			}
		}
	};
}

const shared = createStudyDataCache(loadStudyDataFor);
onStudyWrite((workspaceId) => shared.invalidate(workspaceId));

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
