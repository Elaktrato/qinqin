import type { StudyState } from '../data';
// Settings commands (#193): FSRS parameter sets, the active set, and the daily
// limit rows of the workspace and its decks.

import { newUlid } from '$lib/events/ulid';
import type { ParamSet } from '../fsrs/params';
import type { LimitPair } from '../limits';
import { activeRow, limitsRow, setRow, studyKey, type FsrsActiveRow } from '../rows';
import { extraOf, studyDelete, studyWrite } from '../plan';
import { pushOptional, pushStudy, replanned, requireWorkspaceArg } from './write';

/** saveParamSet stores a new ULID-keyed parameter set; it never makes it active. */
export async function saveParamSet(
	study: StudyState,
	workspaceId: number,
	set: Omit<ParamSet, 'id' | 'createdAt'>,
): Promise<ParamSet> {
	const saved: ParamSet = {
		...set,
		id: newUlid(),
		createdAt: new Date().toISOString(),
	};
	await pushStudy(study, workspaceId, [{ collection: 'fsrsSets', row: setRow(saved) }]);
	return saved;
}

/** setActiveSet points the workspace at a set; null means the defaults. */
export async function setActiveSet(
	study: StudyState,
	workspaceId: number,
	setId: string | null,
): Promise<void> {
	return replanned(study, workspaceId, async ({ snapshot: snap }) => {
		// Already in use: no write (a new changedAt would be a change of nothing).
		const stored = snap.stored.get(studyKey('fsrsActive', ''));
		const current = stored === undefined || stored.deletedAt !== null ? null : (stored as FsrsActiveRow).setId;
		if (current === setId) return;
		const write = studyWrite(
			snap,
			'fsrsActive',
			activeRow(setId, new Date().toISOString(), extraOf(snap, 'fsrsActive', '')),
		);
		if (write !== null) await pushStudy(study, workspaceId, [write]);
	});
}

/** deleteParamSet tombstones a set; the active one cannot be deleted. */
export async function deleteParamSet(
	study: StudyState,
	workspaceId: number,
	id: string,
): Promise<void> {
	return replanned(study, workspaceId, async ({ data: { fsrs }, snapshot: snap }) => {
		if (fsrs?.active?.id === id) {
			throw new Error('Cannot delete the active parameters.');
		}
		// A set that is not stored (another tab deleted it) is already gone.
		const write = studyDelete(snap, 'fsrsSets', id);
		if (write !== null) await pushStudy(study, workspaceId, [write]);
	});
}

/** saveWorkspaceLimits stores the workspace's daily limits (`null` = unlimited). */
export async function saveWorkspaceLimits(study: StudyState, workspaceId: number, limits: Partial<LimitPair>): Promise<void> {
	requireWorkspaceArg(workspaceId, 'saveWorkspaceLimits');
	return replanned(study, workspaceId, async ({ snapshot: snap }) => {
		const write = studyWrite(snap, 'limits', limitsRow(null, limits, extraOf(snap, 'limits', '')));
		if (write !== null) await pushStudy(study, workspaceId, [write]);
	});
}

/**
 * saveDeckLimits stores one deck's overrides (General included). A field
 * left out follows the workspace; an empty object removes the row.
 */
export async function saveDeckLimits(study: StudyState, workspaceId: number, deckId: string, limits: Partial<LimitPair>): Promise<void> {
	requireWorkspaceArg(workspaceId, 'saveDeckLimits');
	return replanned(study, workspaceId, async ({ snapshot: snap }) => {
		if (Object.keys(limits).length === 0) {
			// Nothing left to say: the row goes (another tab may have removed it).
			const write = studyDelete(snap, 'limits', deckId);
			if (write !== null) await pushOptional(study, workspaceId, write);
			return;
		}
		const write = studyWrite(snap, 'limits', limitsRow(deckId, limits, extraOf(snap, 'limits', deckId)));
		if (write !== null) await pushStudy(study, workspaceId, [write]);
	});
}

